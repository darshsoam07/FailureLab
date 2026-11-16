from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
import json

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI, HTTPException, Request, Response

from services.common import authorization
from services.common.database import get_db_session
from services.common.models import User, ProviderIdentity, OAuthTransaction, OperatorRole
from services.experiment_controller import auth, oauth


def session():
    db = AsyncMock()
    db.add = MagicMock()
    return db


def person():
    return User(id=uuid4(), email="person@example.test", first_name="Person", last_name="Test", is_demo=False)


def flow(**kwargs):
    values = dict(state_hash=auth.token_hash("state"), browser_hash=auth.token_hash("browser"),
                  provider="google", verifier="v" * 43, nonce="nonce", expires_at=auth.now() + timedelta(minutes=10),
                  link_user_id=None, session_hash=None)
    return OAuthTransaction(**(values | kwargs))


@pytest.fixture
def configured(monkeypatch):
    for key, value in {
        "AUTH_PUBLIC_BASE_URL": "http://127.0.0.1:5173/controller-api",
        "AUTH_FRONTEND_URL": "http://127.0.0.1:5173",
        "GOOGLE_CLIENT_ID": "google-test", "GOOGLE_CLIENT_SECRET": "google-secret",
        "GITHUB_CLIENT_ID": "github-test", "GITHUB_CLIENT_SECRET": "github-secret",
    }.items():
        monkeypatch.setenv(key, value)
    return oauth.OAuthSettings()


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["google", "github"])
async def test_new_provider_registration_and_returning_signin(provider):
    db = session()
    db.get.return_value = None
    db.scalar.return_value = None
    account = await oauth.resolve_user(db, provider, ("123", "PERSON@example.test", "First", "Last"), flow())
    assert account.email == "person@example.test" and account.password_hash is None
    identity = db.add.call_args_list[-1].args[0]
    assert identity.provider == provider and identity.subject == "123" and identity.user_id == account.id
    db.add.reset_mock()
    db.get.side_effect = [identity, account]
    returned = await oauth.resolve_user(db, provider, ("123", "changed@example.test", "", ""), flow())
    assert returned.id == account.id
    db.add.assert_not_called()


@pytest.mark.asyncio
async def test_collision_requires_authenticated_link_and_cannot_steal_identity():
    db = session(); db.get.return_value = None; db.scalar.return_value = uuid4()
    with pytest.raises(HTTPException) as error:
        await oauth.resolve_user(db, "github", ("123", "person@example.test", "", ""), flow())
    assert error.value.status_code == 409
    account = person()
    db.get.side_effect = [None, account]
    assert await oauth.resolve_user(db, "github", ("123", account.email, "", ""), flow(link_user_id=account.id)) == account
    db.get.side_effect = [ProviderIdentity(provider="github", subject="123", user_id=uuid4())]
    with pytest.raises(HTTPException):
        await oauth.resolve_user(db, "github", ("123", account.email, "", ""), flow(link_user_id=account.id))
    assert list(ProviderIdentity.__table__.primary_key.columns.keys()) == ["provider", "subject"]


@pytest.mark.asyncio
async def test_github_private_email_is_retrieved_and_verified(configured):
    def handler(request):
        if request.url.path.endswith("access_token"):
            assert b"code_verifier=" in request.content
            return httpx.Response(200, json={"access_token": "private-provider-token"})
        if request.url.path == "/user":
            return httpx.Response(200, json={"id": 123, "login": "handle", "email": None})
        return httpx.Response(200, json=[
            {"email": "unverified@example.test", "primary": True, "verified": False},
            {"email": "private@example.test", "primary": False, "verified": True}])
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        result = await oauth.provider_identity("github", "code", flow(), configured, http)
    assert result[:2] == ("123", "private@example.test")


@pytest.mark.asyncio
async def test_google_validates_signature_issuer_audience_nonce_expiry(configured):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key())); jwk["kid"] = "test-key"
    claims = {"iss": "https://accounts.google.com", "aud": "google-test", "sub": "stable-google-id",
              "nonce": "nonce", "iat": auth.now(), "exp": auth.now() + timedelta(minutes=5),
              "email": "verified@example.test", "email_verified": True}
    for change in ({}, {"aud": "wrong"}, {"nonce": "wrong"}, {"iss": "https://attacker.invalid"},
                   {"exp": auth.now() - timedelta(seconds=5)}, {"email_verified": False}):
        encoded = jwt.encode(claims | change, key, algorithm="RS256", headers={"kid": "test-key"})
        def handler(request):
            return httpx.Response(200, json={"keys": [jwk]} if request.method == "GET" else {"id_token": encoded})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            if change:
                with pytest.raises((ValueError, jwt.PyJWTError)):
                    await oauth.provider_identity("google", "code", flow(), configured, http)
            else:
                assert (await oauth.provider_identity("google", "code", flow(), configured, http))[0] == "stable-google-id"


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["google", "github"])
async def test_invalid_authorization_code(provider, configured):
    async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(400, json={"error": "invalid_grant"}))) as http:
        with pytest.raises(httpx.HTTPStatusError):
            await oauth.provider_identity(provider, "invalid", flow(), configured, http)


def make_app(db):
    app = FastAPI()
    app.include_router(auth.router); app.include_router(oauth.router)
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[auth.get_auth_settings] = lambda: auth.AuthSettings(AUTH_COOKIE_SECURE=False)
    return app


@pytest.mark.asyncio
async def test_start_pkce_cookie_and_callback_state_cancellation(configured, monkeypatch):
    db = session(); app = make_app(db)
    exchange = AsyncMock()
    monkeypatch.setattr(oauth, "provider_identity", exchange)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        result = await client.post("/api/auth/oauth/google/start", headers={"X-FailureLab-Auth": "1"})
        assert result.status_code == 200 and "code_challenge_method=S256" in result.json()["authorization_url"]
        assert "HttpOnly" in result.headers["set-cookie"] and "SameSite=lax" in result.headers["set-cookie"]
        assert "google-secret" not in result.text
        db.scalar.return_value = flow()
        client.cookies.set(oauth.FLOW_COOKIE, "wrong")
        result = await client.get("/api/auth/oauth/google/callback?state=state&code=sensitive")
        assert "auth_error=failed" in result.headers["location"]
        db.delete.assert_not_called()
        client.cookies.clear(); client.cookies.set(oauth.FLOW_COOKIE, "browser")
        result = await client.get("/api/auth/oauth/google/callback?state=state&error=access_denied")
        assert "auth_error=cancelled" in result.headers["location"]
        db.delete.assert_awaited_once()
        exchange.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["google", "github"])
async def test_callback_session_refresh_logout(provider, configured, monkeypatch):
    db = session(); account = person()
    db.scalar.return_value = flow(provider=provider)
    monkeypatch.setattr(oauth, "provider_identity", AsyncMock(return_value=("123", account.email, "Person", "Test")))
    monkeypatch.setattr(oauth, "resolve_user", AsyncMock(return_value=account))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=make_app(db)), base_url="http://test") as client:
        client.cookies.set(oauth.FLOW_COOKIE, "browser")
        result = await client.get(f"/api/auth/oauth/{provider}/callback?state=state&code=code")
        assert result.status_code == 303 and result.headers["location"] == configured.AUTH_FRONTEND_URL
        assert "HttpOnly" in result.headers["set-cookie"] and "SameSite=strict" in result.headers["set-cookie"]
        db.scalar.return_value = account; db.get.return_value = None
        for _ in range(2):
            assert (await client.get("/api/auth/me")).json()["user"]["id"] == str(account.id)
        result = await client.post("/api/auth/logout", headers={"X-FailureLab-Auth": "1"})
        assert result.status_code == 200 and "Max-Age=0" in result.headers["set-cookie"]
        db.scalar.return_value = None
        assert (await client.get("/api/auth/me")).status_code == 401


@pytest.mark.asyncio
async def test_authorization_anonymous_viewer_operator_and_internal(monkeypatch):
    db = session(); db.scalar.return_value = person(); db.get.return_value = None
    manager = MagicMock()
    manager.__aenter__ = AsyncMock(return_value=db); manager.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr(authorization, "get_session_factory", lambda: lambda: manager)
    monkeypatch.delenv("INTERNAL_SERVICE_TOKEN", raising=False)
    app = FastAPI(dependencies=[Depends(authorization.authorize)])
    @app.api_route("/api/experiments/start", methods=["GET", "POST"])
    async def protected():
        return {"ok": True}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.post("/api/experiments/start")).status_code == 401
        client.cookies.set(auth.COOKIE, "session")
        assert (await client.get("/api/experiments/start")).status_code == 200
        assert (await client.post("/api/experiments/start")).status_code == 403
        headers = {"X-FailureLab-Auth": "1"}
        assert (await client.post("/api/experiments/start", headers=headers)).status_code == 403
        db.get.return_value = OperatorRole(user_id=db.scalar.return_value.id)
        assert (await client.post("/api/experiments/start", headers=headers)).status_code == 200
        db.scalar.return_value = None
        assert (await client.get("/api/experiments/start")).status_code == 401
        monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "x" * 40)
        assert (await client.post("/api/experiments/start", headers={"Authorization": "Bearer " + "x" * 40})).status_code == 200


@pytest.mark.asyncio
async def test_real_controller_and_order_reject_anonymous():
    from services.experiment_controller.main import app as controller
    from services.order_api.main import app as orders
    for app, path in [(controller, "/api/experiments/start"), (controller, "/api/traffic/toggle"),
                      (orders, "/api/orders")]:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            assert (await client.post(path, json={})).status_code == 401


def test_urls_and_provider_allowlist(configured):
    with pytest.raises(ValueError):
        oauth.OAuthSettings(AUTH_FRONTEND_URL="https://user:password@example.test")
    with pytest.raises(HTTPException):
        configured.credentials("facebook")


@pytest.mark.asyncio
@pytest.mark.parametrize("bad_flow", [None, flow(expires_at=auth.now() - timedelta(minutes=1)),
                                     flow(provider="github")])
async def test_missing_expired_replayed_or_wrong_provider_state(bad_flow, configured, monkeypatch):
    db = session(); db.scalar.return_value = bad_flow
    exchange = AsyncMock(); monkeypatch.setattr(oauth, "provider_identity", exchange)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=make_app(db)), base_url="http://test") as client:
        client.cookies.set(oauth.FLOW_COOKIE, "browser")
        result = await client.get("/api/auth/oauth/google/callback?state=state&code=code")
        assert result.status_code == 303 and "auth_error=failed" in result.headers["location"]
    exchange.assert_not_called()


@pytest.mark.asyncio
async def test_github_without_verified_email_rejected(configured):
    def handler(request):
        payload = {"access_token": "token"} if request.method == "POST" else (
            {"id": 123, "login": "person", "email": None} if request.url.path == "/user" else [])
        return httpx.Response(200, json=payload)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(ValueError, match="No verified email"):
            await oauth.provider_identity("github", "code", flow(), configured, http)


@pytest.mark.asyncio
async def test_concurrent_duplicate_callback_rolls_back_without_session(configured, monkeypatch):
    from sqlalchemy.exc import IntegrityError
    db = session(); db.scalar.return_value = flow()
    monkeypatch.setattr(oauth, "provider_identity", AsyncMock(return_value=("123", "person@example.test", "", "")))
    monkeypatch.setattr(oauth, "resolve_user", AsyncMock(side_effect=IntegrityError("insert", {}, Exception())))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=make_app(db)), base_url="http://test") as client:
        client.cookies.set(oauth.FLOW_COOKIE, "browser")
        result = await client.get("/api/auth/oauth/google/callback?state=state&code=code")
        assert "account_conflict" in result.headers["location"]
        assert auth.COOKIE not in result.headers["set-cookie"]
        db.rollback.assert_awaited()


@pytest.mark.asyncio
async def test_link_requires_live_original_session(configured, monkeypatch):
    db = session(); db.scalar.side_effect = [flow(link_user_id=uuid4(), session_hash="old"), None]
    exchange = AsyncMock(); monkeypatch.setattr(oauth, "provider_identity", exchange)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=make_app(db)), base_url="http://test") as client:
        client.cookies.set(oauth.FLOW_COOKIE, "browser")
        result = await client.get("/api/auth/oauth/google/callback?state=state&code=code")
        assert "auth_error=failed" in result.headers["location"]
    exchange.assert_not_called()


@pytest.mark.asyncio
async def test_callback_access_log_redacts_query_before_response():
    from services.common.safe_access_log import OAuthQueryRedaction
    scope = {"type": "http", "path": "/api/auth/oauth/google/callback", "query_string": b"code=secret"}
    async def app(scope, receive, send):
        assert scope["query_string"] == b"code=secret"
        await send({"type": "http.response.start", "status": 303})
    async def send(message):
        assert scope["query_string"] == b""
    await OAuthQueryRedaction(app)(scope, AsyncMock(), send)


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["google", "github"])
async def test_provider_start_enabled_only_with_real_configuration(provider, configured, monkeypatch):
    db = session()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=make_app(db)), base_url="http://test") as client:
        before = await client.get("/api/auth/config")
        assert before.headers["cache-control"] == "no-store"
        assert before.json()["providers"][provider] is True
        monkeypatch.delenv(provider.upper() + "_CLIENT_SECRET")
        after = await client.get("/api/auth/config")
        assert after.json()["providers"][provider] is False
        assert provider.upper() + "_CLIENT_SECRET" in after.json()["provider_status"][provider]["missing"]
        assert "google-secret" not in after.text and "github-secret" not in after.text
        result = await client.post(f"/api/auth/oauth/{provider}/start", headers={"X-FailureLab-Auth": "1"})
        assert result.status_code == 503
        monkeypatch.setenv(provider.upper() + "_CLIENT_SECRET", "configured-secret")
        result = await client.post(f"/api/auth/oauth/{provider}/start", headers={"X-FailureLab-Auth": "1"})
        assert result.status_code == 200
        from urllib.parse import parse_qs, urlsplit
        params = parse_qs(urlsplit(result.json()["authorization_url"]).query)
        assert params["redirect_uri"] == [configured.callback(provider)]
        assert params["code_challenge_method"] == ["S256"]


@pytest.mark.asyncio
async def test_bad_url_configuration_reports_safe_reason(configured, monkeypatch):
    monkeypatch.setenv("AUTH_FRONTEND_URL", "http://localhost:5173")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=make_app(session())), base_url="http://test") as client:
        result = await client.get("/api/auth/config")
        assert result.json()["provider_status"]["google"]["reason"] == "invalid_urls"
        assert result.json()["providers"] == {"google": False, "github": False}
        result = await client.post("/api/auth/oauth/google/start", headers={"X-FailureLab-Auth": "1"})
        assert result.status_code == 503
        assert "google-secret" not in result.text and "github-secret" not in result.text


def test_secure_cookie_and_blank_credentials_readiness(configured, monkeypatch):
    monkeypatch.setenv("AUTH_FRONTEND_URL", "https://failurelab.example")
    monkeypatch.setenv("AUTH_PUBLIC_BASE_URL", "https://failurelab.example/controller-api")
    result = oauth.provider_readiness(auth.AuthSettings(AUTH_COOKIE_SECURE=False))
    assert result["provider_status"]["google"]["reason"] == "secure_cookie_required"
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "   ")
    result = oauth.provider_readiness(auth.AuthSettings())
    assert result["providers"]["google"] is False
    assert "GOOGLE_CLIENT_SECRET" in result["provider_status"]["google"]["missing"]


def test_private_dotenv_loading_and_environment_precedence(tmp_path, monkeypatch):
    path = tmp_path / ".env"
    path.write_text("AUTH_PUBLIC_BASE_URL=http://127.0.0.1:5173/controller-api\n"
                    "AUTH_FRONTEND_URL=http://127.0.0.1:5173\nGOOGLE_CLIENT_ID=from-file\n"
                    "GOOGLE_CLIENT_SECRET=file-secret\nAUTH_SMTP_PORT=\n")
    settings = oauth.OAuthSettings(_env_file=path)
    assert settings.credentials("google") == ("from-file", "file-secret")
    assert auth.AuthSettings(_env_file=path).AUTH_SMTP_PORT is None
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "from-environment")
    assert oauth.OAuthSettings(_env_file=path).GOOGLE_CLIENT_ID == "from-environment"
