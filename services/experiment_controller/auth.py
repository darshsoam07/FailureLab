"""Optional dashboard authentication; existing reliability APIs remain public."""

import asyncio
import hashlib
import hmac
import secrets
import smtplib
import ssl
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from functools import lru_cache
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from services.common.database import get_db_session, get_engine
from services.common.models import AuthBase, AuthSession, PasswordResetCode, User
from services.common.schemas import (
    AuthEmail, AuthLogin, AuthOAuthMock, AuthResetPassword, AuthSignup,
    AuthUserResponse, AuthVerifyCode,
)

COOKIE = "failurelab_session"
ITERATIONS = 600_000
_EPHEMERAL_RESET_KEY = secrets.token_bytes(32)


class AuthSettings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")
    AUTH_DEMO_MODE: bool = False
    AUTH_COOKIE_SECURE: bool = True
    AUTH_SESSION_SECONDS: int = Field(default=28800, ge=300, le=604800)
    AUTH_RESET_SECRET: SecretStr | None = None
    AUTH_SMTP_HOST: str | None = None
    AUTH_SMTP_PORT: int | None = Field(default=None, ge=1, le=65535)
    AUTH_SMTP_FROM: str | None = None
    AUTH_SMTP_USERNAME: str | None = None
    AUTH_SMTP_PASSWORD: SecretStr | None = None
    AUTH_SMTP_TIMEOUT_SECONDS: float = Field(default=10, gt=0, le=30)


@lru_cache
def get_auth_settings() -> AuthSettings:
    return AuthSettings()


async def init_auth_db() -> None:
    async with get_engine().begin() as connection:
        await connection.execute(text("SELECT pg_advisory_xact_lock(721148320042)"))
        await connection.run_sync(AuthBase.metadata.create_all)


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${salt}${digest.hex()}"


def check_password(password: str, encoded: str | None) -> bool:
    try:
        algorithm, iterations, salt, expected = (encoded or "").split("$")
        if algorithm != "pbkdf2_sha256" or not 100_000 <= int(iterations) <= 2_000_000:
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations)).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


_DUMMY_PASSWORD = hash_password(secrets.token_urlsafe(32))


def token_hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def code_hash(reset_id, code: str, settings: AuthSettings) -> str:
    key = settings.AUTH_RESET_SECRET.get_secret_value().encode() if settings.AUTH_RESET_SECRET else _EPHEMERAL_RESET_KEY
    return hmac.new(key, f"{reset_id}:{code}".encode(), hashlib.sha256).hexdigest()


def now() -> datetime:
    return datetime.now(timezone.utc)


def require_auth_header(request: Request) -> None:
    # Custom header + SameSite=Strict cookies prevent cross-site HTML form writes.
    # No permissive CORS middleware is installed by this router.
    if request.headers.get("X-FailureLab-Auth") != "1":
        raise HTTPException(403, "Missing authentication request header")


router = APIRouter(prefix="/api/auth", tags=["dashboard authentication"])
DB = Annotated[AsyncSession, Depends(get_db_session)]
Settings = Annotated[AuthSettings, Depends(get_auth_settings)]
write_dependencies = [Depends(require_auth_header)]


async def create_session(user: User, session: AsyncSession, response: Response, settings: AuthSettings) -> dict:
    token = secrets.token_urlsafe(32)
    session.add(AuthSession(token_hash=token_hash(token), user_id=user.id,
                            expires_at=now() + timedelta(seconds=settings.AUTH_SESSION_SECONDS)))
    await session.execute(delete(AuthSession).where(AuthSession.expires_at <= now()))
    await session.commit()
    response.set_cookie(COOKIE, token, httponly=True, secure=settings.AUTH_COOKIE_SECURE,
                        samesite="strict", max_age=settings.AUTH_SESSION_SECONDS, path="/")
    response.headers["Cache-Control"] = "no-store"
    return {"user": AuthUserResponse.model_validate(user).model_dump(mode="json")}


@router.get("/config")
async def config(settings: Settings):
    return {"demo_mode": settings.AUTH_DEMO_MODE, "password_min_length": 12}


@router.post("/signup", status_code=201, dependencies=write_dependencies)
async def signup(body: AuthSignup, session: DB, response: Response, settings: Settings):
    user = User(id=uuid4(), email=body.email, first_name=body.first_name, last_name=body.last_name,
                password_hash=await asyncio.to_thread(hash_password, body.password.get_secret_value()),
                password_history=[], failed_login_attempts=0, is_demo=False)
    session.add(user)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(409, "Unable to create account with this email. Try logging in.") from None
    return await create_session(user, session, response, settings)


@router.post("/login", dependencies=write_dependencies)
async def login(body: AuthLogin, session: DB, response: Response, settings: Settings):
    user = await session.scalar(select(User).where(User.email == body.email).with_for_update())
    valid = await asyncio.to_thread(check_password, body.password.get_secret_value(),
                                    user.password_hash if user and user.password_hash else _DUMMY_PASSWORD)
    if not user or user.is_demo:
        raise HTTPException(401, "Invalid email or password")
    if user.locked_until and user.locked_until > now():
        raise HTTPException(429, "Too many attempts. Try again later.")
    if not valid:
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= 5:
            user.locked_until = now() + timedelta(minutes=5)
            user.failed_login_attempts = 0
        await session.commit()
        raise HTTPException(401, "Invalid email or password")
    user.failed_login_attempts = 0
    user.locked_until = None
    return await create_session(user, session, response, settings)


@router.get("/me")
async def me(request: Request, response: Response, session: DB, settings: Settings):
    response.headers["Cache-Control"] = "no-store"
    token = request.cookies.get(COOKIE, "")
    user = await session.scalar(select(User).join(AuthSession).where(
        AuthSession.token_hash == token_hash(token), AuthSession.expires_at > now()))
    if not user or (user.is_demo and not settings.AUTH_DEMO_MODE):
        raise HTTPException(401, "Sign in to continue")
    return {"user": AuthUserResponse.model_validate(user)}


@router.post("/logout", dependencies=write_dependencies)
async def logout(request: Request, response: Response, session: DB):
    await session.execute(delete(AuthSession).where(AuthSession.token_hash == token_hash(request.cookies.get(COOKIE, ""))))
    await session.commit()
    response.delete_cookie(COOKIE, path="/", samesite="strict")
    response.headers["Cache-Control"] = "no-store"
    return {"message": "Signed out"}


def send_code(email: str, code: str, settings: AuthSettings) -> None:
    message = EmailMessage()
    message["From"] = settings.AUTH_SMTP_FROM
    message["To"] = email
    message["Subject"] = "FailureLab password reset code"
    message.set_content(f"Your FailureLab verification code is {code}. It expires in 10 minutes. If you did not request it, ignore this message.")
    with smtplib.SMTP(settings.AUTH_SMTP_HOST, settings.AUTH_SMTP_PORT,
                      timeout=settings.AUTH_SMTP_TIMEOUT_SECONDS) as smtp:
        smtp.starttls(context=ssl.create_default_context())
        if settings.AUTH_SMTP_USERNAME:
            smtp.login(settings.AUTH_SMTP_USERNAME,
                       settings.AUTH_SMTP_PASSWORD.get_secret_value() if settings.AUTH_SMTP_PASSWORD else "")
        smtp.send_message(message)


@router.post("/forgot-password", dependencies=write_dependencies)
async def forgot(body: AuthEmail, session: DB, response: Response, settings: Settings):
    response.headers["Cache-Control"] = "no-store"
    if not settings.AUTH_DEMO_MODE and not all((
        settings.AUTH_SMTP_HOST, settings.AUTH_SMTP_PORT, settings.AUTH_SMTP_FROM,
        settings.AUTH_RESET_SECRET and len(settings.AUTH_RESET_SECRET.get_secret_value()) >= 32,
    )):
        raise HTTPException(503, "Password recovery is not configured. Contact the operator.")
    user = await session.scalar(select(User).where(User.email == body.email).with_for_update())
    reset_id, code = uuid4(), f"{secrets.randbelow(10000):04d}"
    result = {"reset_id": str(reset_id), "message": "If this account exists, a verification code has been sent.",
              "retry_after_seconds": 30}
    if user and not user.is_demo:
        latest = await session.scalar(select(PasswordResetCode).where(
            PasswordResetCode.user_id == user.id).order_by(PasswordResetCode.created_at.desc()).limit(1))
        if latest and (now() - latest.created_at).total_seconds() < 30:
            raise HTTPException(429, "Wait 30 seconds before requesting another code", headers={"Retry-After": "30"})
        await session.execute(update(PasswordResetCode).where(
            PasswordResetCode.user_id == user.id).values(consumed=True))
        session.add(PasswordResetCode(id=reset_id, user_id=user.id,
            code_hash=code_hash(reset_id, code, settings), attempts=0, created_at=now(),
            expires_at=now() + timedelta(minutes=10), consumed=False, verified=False))
        if not settings.AUTH_DEMO_MODE:
            try:
                await asyncio.to_thread(send_code, user.email, code, settings)
            except (OSError, smtplib.SMTPException):
                await session.rollback()
                raise HTTPException(503, "Unable to deliver recovery email. Try again later.") from None
        await session.commit()
    if settings.AUTH_DEMO_MODE:
        # Explicitly opt-in, local demo metadata; never emitted in normal mode.
        result["dev_code"] = code
    return result


async def locked_reset(session: AsyncSession, reset_id) -> PasswordResetCode:
    # Lock user then challenge consistently with login/forgot, avoiding deadlocks
    # and serializing simultaneous reset/password changes for the same account.
    candidate = await session.get(PasswordResetCode, reset_id)
    if not candidate:
        raise HTTPException(400, "Invalid or expired verification request")
    await session.scalar(select(User).where(User.id == candidate.user_id).with_for_update())
    record = await session.scalar(select(PasswordResetCode).where(PasswordResetCode.id == reset_id)
                                  .with_for_update().execution_options(populate_existing=True))
    if not record or record.consumed or record.expires_at <= now() or (not record.verified and record.attempts >= 5):
        raise HTTPException(400, "Invalid or expired verification request")
    return record


@router.post("/verify-code", dependencies=write_dependencies)
async def verify(body: AuthVerifyCode, session: DB, response: Response, settings: Settings):
    response.headers["Cache-Control"] = "no-store"
    record = await locked_reset(session, body.reset_id)
    if record.verified:
        raise HTTPException(400, "Code already verified. Request a new code to restart.")
    record.attempts += 1
    if not hmac.compare_digest(record.code_hash, code_hash(record.id, body.code, settings)):
        await session.commit()  # Failed attempts must survive the error response.
        raise HTTPException(400, "Incorrect verification code")
    token = secrets.token_urlsafe(32)
    record.verified = True
    record.reset_token_hash = token_hash(token)
    await session.commit()
    return {"reset_token": token}


@router.post("/reset-password", dependencies=write_dependencies)
async def reset_password(body: AuthResetPassword, session: DB, response: Response):
    response.headers["Cache-Control"] = "no-store"
    record = await locked_reset(session, body.reset_id)
    if not record.verified or not hmac.compare_digest(
        record.reset_token_hash or "", token_hash(body.reset_token.get_secret_value())
    ):
        raise HTTPException(400, "Invalid or expired reset token")
    user = await session.get(User, record.user_id)
    password = body.password.get_secret_value()
    for previous in [user.password_hash, *(user.password_history or [])]:
        if previous and await asyncio.to_thread(check_password, password, previous):
            raise HTTPException(400, "Choose a password different from your previous passwords")
    user.password_history = [*(user.password_history or []), user.password_hash]
    user.password_hash = await asyncio.to_thread(hash_password, password)
    user.failed_login_attempts, user.locked_until = 0, None
    await session.execute(update(PasswordResetCode).where(
        PasswordResetCode.user_id == user.id).values(consumed=True))
    await session.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    await session.commit()
    response.delete_cookie(COOKIE, path="/", samesite="strict")
    return {"message": "Password reset successfully. Log in with your new password."}


@router.post("/oauth-mock", dependencies=write_dependencies)
async def oauth_mock(body: AuthOAuthMock, session: DB, response: Response, settings: Settings):
    if not settings.AUTH_DEMO_MODE:
        raise HTTPException(404, "Demo sign-in is disabled")
    user_id = uuid4()
    # A fresh, clearly marked demo identity can never claim a real user's email.
    user = User(id=user_id, email=f"demo-{user_id}@example.invalid", first_name=body.provider.title(),
                last_name="Demo", is_demo=True, password_history=[], failed_login_attempts=0)
    session.add(user)
    await session.flush()
    return await create_session(user, session, response, settings)
