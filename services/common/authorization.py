"""Shared fail-closed API authorization for browser sessions and internal services."""
import hashlib
import hmac
from datetime import datetime, timezone
from fastapi import HTTPException, Request
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import select
from .database import get_session_factory
from .config import ENV_FILE
from .models import AuthSession, User, OperatorRole


class SecuritySettings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore", env_file=ENV_FILE, env_file_encoding="utf-8", env_ignore_empty=True)
    INTERNAL_SERVICE_TOKEN: SecretStr | None = None


def internal_headers() -> dict[str, str]:
    token = SecuritySettings().INTERNAL_SERVICE_TOKEN
    return {"Authorization": "Bearer " + token.get_secret_value()} if token else {}


async def authorize(request: Request):
    path = request.url.path
    if path in {"/health", "/ready", "/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc"} or path.startswith("/api/auth/"):
        return
    secret = SecuritySettings().INTERNAL_SERVICE_TOKEN
    supplied = request.headers.get("Authorization", "")
    if secret and len(secret.get_secret_value()) >= 32 and hmac.compare_digest(
        supplied, "Bearer " + secret.get_secret_value()
    ):
        return  # Trusted machine principal, never exposed in frontend configuration.
    token = request.cookies.get("failurelab_session")
    if not token:
        raise HTTPException(401, "Sign in to continue")
    async with get_session_factory()() as db:
        user = await db.scalar(select(User).join(AuthSession).where(
            AuthSession.token_hash == hashlib.sha256(token.encode()).hexdigest(),
            AuthSession.expires_at > datetime.now(timezone.utc), User.is_demo.is_(False)))
        if not user:
            raise HTTPException(401, "Session expired")
        if path.startswith("/api/inventory/"):
            raise HTTPException(403, "Internal service credentials required")
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            if request.headers.get("X-FailureLab-Auth") != "1":
                raise HTTPException(403, "Missing CSRF header")
            if not await db.get(OperatorRole, user.id):
                raise HTTPException(403, "Operator permission required")
