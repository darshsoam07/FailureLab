from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI, HTTPException, Response
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateTable

from services.common import models, schemas
from services.common.database import Base, get_db_session
from services.experiment_controller import auth


def db():
    session = AsyncMock()
    session.add = MagicMock()
    return session


def user(**kwargs):
    return models.User(id=uuid4(), email="person@example.test", first_name="Test", last_name="User",
                       password_hash=auth.hash_password("long original password"), password_history=[],
                       failed_login_attempts=0, is_demo=False, **kwargs)


def reset_record(person, **kwargs):
    return models.PasswordResetCode(id=uuid4(), user_id=person.id, code_hash="",
        attempts=0, expires_at=auth.now() + timedelta(minutes=10), created_at=auth.now(),
        consumed=False, verified=False, **kwargs)


def test_password_hashes_are_salted_and_reject_wrong_or_malformed_values():
    a, b = auth.hash_password("a long passphrase"), auth.hash_password("a long passphrase")
    assert a != b and "a long passphrase" not in a
    assert auth.check_password("a long passphrase", a)
    assert not auth.check_password("wrong", a)
    assert not auth.check_password("anything", "malformed")
    assert not auth.check_password("anything", "pbkdf2_sha256$999999999$a$b")


def test_auth_schema_is_separate_and_has_unique_email_and_foreign_keys():
    assert len(Base.metadata.tables) == 7
    assert len(models.AuthBase.metadata.tables) == 3
    assert models.User.__table__.c.email.unique
    for table in models.AuthBase.metadata.tables.values():
        assert "CREATE TABLE" in str(CreateTable(table).compile(dialect=postgresql.dialect()))


def test_email_password_and_code_validation():
    assert schemas.AuthEmail(email=" Person@Example.test ").email == "person@example.test"
    for email in ["bad", "a@b", "a\r\n@b.test"]:
        with pytest.raises(ValidationError):
            schemas.AuthEmail(email=email)
    with pytest.raises(ValidationError):
        schemas.AuthSignup(email="a@b.test", first_name="A", last_name="B", password="short", terms_accepted=True)
    with pytest.raises(ValidationError):
        schemas.AuthVerifyCode(reset_id=uuid4(), code="12a4")
    with pytest.raises(ValidationError):
        schemas.AuthOAuthMock(provider="arbitrary-provider")


@pytest.mark.asyncio
async def test_signup_issues_http_only_session_and_never_returns_password():
    session, response = db(), Response()
    result = await auth.signup(schemas.AuthSignup(email="a@b.test", first_name="A", last_name="B",
        password="long password for tests", terms_accepted=True), session, response, auth.AuthSettings())
    assert result["user"]["email"] == "a@b.test"
    assert "password" not in str(result)
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie and "Secure" in cookie and "SameSite=strict" in cookie
    session.commit.assert_awaited_once()
    assert isinstance(session.add.call_args_list[1].args[0], models.AuthSession)


@pytest.mark.asyncio
async def test_duplicate_signup_rolls_back():
    session = db()
    session.flush.side_effect = IntegrityError("insert", {}, Exception())
    with pytest.raises(HTTPException) as exc:
        await auth.signup(schemas.AuthSignup(email="a@b.test", first_name="A", last_name="B",
            password="long password for tests", terms_accepted=True), session, Response(), auth.AuthSettings())
    assert exc.value.status_code == 409
    session.rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_login_failed_attempts_commit_and_lock_after_five():
    person, session = user(), db()
    session.scalar.return_value = person
    for _ in range(5):
        with pytest.raises(HTTPException) as exc:
            await auth.login(schemas.AuthLogin(email=person.email, password="wrong"), session, Response(), auth.AuthSettings())
        assert exc.value.status_code == 401
    assert person.locked_until > auth.now()
    assert session.commit.await_count == 5
    with pytest.raises(HTTPException) as exc:
        await auth.login(schemas.AuthLogin(email=person.email, password="long original password"), session, Response(), auth.AuthSettings())
    assert exc.value.status_code == 429


@pytest.mark.asyncio
async def test_login_success_and_unknown_user_generic_failure():
    session, person = db(), user()
    session.scalar.return_value = person
    result = await auth.login(schemas.AuthLogin(email=person.email, password="long original password"), session, Response(), auth.AuthSettings())
    assert result["user"]["id"] == str(person.id)
    session.scalar.return_value = None
    with pytest.raises(HTTPException) as exc:
        await auth.login(schemas.AuthLogin(email=person.email, password="wrong"), session, Response(), auth.AuthSettings())
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_forgot_demo_code_hash_expiry_and_previous_code_invalidation():
    person, session = user(), db()
    session.scalar.side_effect = [person, None]
    settings = auth.AuthSettings(AUTH_DEMO_MODE=True)
    response = Response()
    result = await auth.forgot(schemas.AuthEmail(email=person.email), session, response, settings)
    record = session.add.call_args.args[0]
    assert len(result["dev_code"]) == 4
    assert record.code_hash == auth.code_hash(record.id, result["dev_code"], settings)
    assert record.code_hash != result["dev_code"]
    assert 599 <= (record.expires_at - record.created_at).total_seconds() <= 601
    assert "UPDATE password_reset_codes" in str(session.execute.call_args.args[0])
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.asyncio
async def test_forgot_unknown_email_uses_generic_response():
    session = db(); session.scalar.return_value = None
    result = await auth.forgot(schemas.AuthEmail(email="absent@example.test"), session, Response(), auth.AuthSettings(AUTH_DEMO_MODE=True))
    assert result["reset_id"] and result["dev_code"]
    session.add.assert_not_called()


@pytest.mark.asyncio
async def test_forgot_server_cooldown_and_production_configuration():
    session, person = db(), user()
    session.scalar.side_effect = [person, reset_record(person)]
    with pytest.raises(HTTPException) as exc:
        await auth.forgot(schemas.AuthEmail(email=person.email), session, Response(), auth.AuthSettings(AUTH_DEMO_MODE=True))
    assert exc.value.status_code == 429
    with pytest.raises(HTTPException) as exc:
        await auth.forgot(schemas.AuthEmail(email=person.email), session, Response(), auth.AuthSettings())
    assert exc.value.status_code == 503


@pytest.mark.asyncio
async def test_non_demo_delivery_does_not_return_code(monkeypatch):
    person, session = user(), db()
    session.scalar.side_effect = [person, None]
    send = MagicMock()
    monkeypatch.setattr(auth, "send_code", send)
    settings = auth.AuthSettings(AUTH_SMTP_HOST="mail.example.test", AUTH_SMTP_PORT=2525,
        AUTH_SMTP_FROM="auth@example.test", AUTH_RESET_SECRET="x" * 32)
    result = await auth.forgot(schemas.AuthEmail(email=person.email), session, Response(), settings)
    assert "dev_code" not in result
    send.assert_called_once()


@pytest.mark.asyncio
async def test_verify_five_wrong_attempts_lock_challenge():
    person, session, settings = user(), db(), auth.AuthSettings(AUTH_DEMO_MODE=True)
    record = reset_record(person)
    record.code_hash = auth.code_hash(record.id, "1234", settings)
    session.get.return_value = record
    session.scalar.side_effect = [person, record] * 6
    for _ in range(5):
        with pytest.raises(HTTPException):
            await auth.verify(schemas.AuthVerifyCode(reset_id=record.id, code="0000"), session, Response(), settings)
    assert record.attempts == 5 and session.commit.await_count == 5
    with pytest.raises(HTTPException):
        await auth.verify(schemas.AuthVerifyCode(reset_id=record.id, code="1234"), session, Response(), settings)
    assert not record.verified


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["expired", "consumed"])
async def test_expired_and_used_challenges_are_rejected(state):
    person, session = user(), db()
    record = reset_record(person)
    if state == "expired": record.expires_at = auth.now() - timedelta(seconds=1)
    else: record.consumed = True
    session.get.return_value = record
    session.scalar.side_effect = [person, record]
    with pytest.raises(HTTPException):
        await auth.locked_reset(session, record.id)


@pytest.mark.asyncio
async def test_verified_reset_changes_password_and_revokes_all_sessions():
    person, session, settings = user(), db(), auth.AuthSettings(AUTH_DEMO_MODE=True)
    record = reset_record(person)
    record.attempts = 4  # A correct fifth attempt must still permit reset.
    record.code_hash = auth.code_hash(record.id, "1234", settings)
    session.get.return_value = record
    session.scalar.side_effect = [person, record]
    verified = await auth.verify(schemas.AuthVerifyCode(reset_id=record.id, code="1234"), session, Response(), settings)
    assert record.verified and record.attempts == 5
    assert record.reset_token_hash == auth.token_hash(verified["reset_token"])
    session.get.side_effect = [record, person]
    session.scalar.side_effect = [person, record]
    result = await auth.reset_password(schemas.AuthResetPassword(reset_id=record.id,
        reset_token=verified["reset_token"], password="a completely new password"), session, Response())
    assert "successfully" in result["message"]
    assert auth.check_password("a completely new password", person.password_hash)
    statements = [str(call.args[0]) for call in session.execute.call_args_list]
    assert any("DELETE FROM auth_sessions" in sql for sql in statements)
    assert any("UPDATE password_reset_codes" in sql for sql in statements)


@pytest.mark.asyncio
async def test_reset_requires_token_and_rejects_password_reuse():
    person, session = user(), db()
    record = reset_record(person)
    record.verified = True; record.reset_token_hash = auth.token_hash("t" * 43)
    for token, password in [("z" * 43, "a completely new password"), ("t" * 43, "long original password")]:
        session.get.side_effect = [record, person]
        session.scalar.side_effect = [person, record]
        with pytest.raises(HTTPException):
            await auth.reset_password(schemas.AuthResetPassword(reset_id=record.id, reset_token=token, password=password), session, Response())
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_oauth_mock_is_opt_in_and_cannot_impersonate_real_email():
    session = db()
    with pytest.raises(HTTPException) as exc:
        await auth.oauth_mock(schemas.AuthOAuthMock(provider="google"), session, Response(), auth.AuthSettings())
    assert exc.value.status_code == 404
    result = await auth.oauth_mock(schemas.AuthOAuthMock(provider="google"), session, Response(), auth.AuthSettings(AUTH_DEMO_MODE=True))
    assert result["user"]["is_demo"] and result["user"]["email"].endswith("@example.invalid")


@pytest.mark.asyncio
async def test_http_auth_routes_require_custom_header_but_config_is_public():
    app = FastAPI(); app.include_router(auth.router)
    session = db(); session.scalar.return_value = None
    app.dependency_overrides[get_db_session] = lambda: session
    app.dependency_overrides[auth.get_auth_settings] = lambda: auth.AuthSettings()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/auth/config")).status_code == 200
        assert (await client.get("/api/auth/me")).status_code == 401
        assert (await client.post("/api/auth/logout", json={})).status_code == 403
        result = await client.post("/api/auth/logout", json={}, headers={"X-FailureLab-Auth": "1"})
        assert result.status_code == 200
        assert "Max-Age=0" in result.headers["set-cookie"]
