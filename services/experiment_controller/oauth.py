"""Server-side authorization code + PKCE; provider tokens are never persisted."""
import asyncio
import base64
import hashlib
import hmac
import secrets
from datetime import timedelta
from urllib.parse import urlencode, urlsplit
from uuid import uuid4

import httpx
import jwt
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import SecretStr, ValidationError, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from services.common.models import User, ProviderIdentity, OAuthTransaction, AuthSession
from services.common.config import ENV_FILE
from .auth import DB, Settings, COOKIE, create_session, now, token_hash, require_auth_header


class OAuthSettings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore", env_file=ENV_FILE, env_file_encoding="utf-8", env_ignore_empty=True)
    AUTH_PUBLIC_BASE_URL: str | None = None
    AUTH_FRONTEND_URL: str | None = None
    GOOGLE_CLIENT_ID: str | None = None
    GOOGLE_CLIENT_SECRET: SecretStr | None = None
    GITHUB_CLIENT_ID: str | None = None
    GITHUB_CLIENT_SECRET: SecretStr | None = None
    GOOGLE_AUTHORIZE_URL: str = "https://accounts.google.com/o/oauth2/v2/auth"
    GOOGLE_TOKEN_URL: str = "https://oauth2.googleapis.com/token"
    GOOGLE_JWKS_URL: str = "https://www.googleapis.com/oauth2/v3/certs"
    GITHUB_AUTHORIZE_URL: str = "https://github.com/login/oauth/authorize"
    GITHUB_TOKEN_URL: str = "https://github.com/login/oauth/access_token"
    GITHUB_API_URL: str = "https://api.github.com"

    @model_validator(mode="after")
    def safe_urls(self):
        for value in (self.AUTH_PUBLIC_BASE_URL, self.AUTH_FRONTEND_URL):
            if value:
                parsed = urlsplit(value)
                if (parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username
                    or parsed.password or parsed.query or parsed.fragment
                    or (parsed.scheme == "http" and parsed.hostname not in {"localhost", "127.0.0.1", "::1"})):
                    raise ValueError("Auth URLs require HTTPS, except loopback development; no credentials/query/fragment")
        if self.AUTH_PUBLIC_BASE_URL and self.AUTH_FRONTEND_URL:
            public, frontend = urlsplit(self.AUTH_PUBLIC_BASE_URL), urlsplit(self.AUTH_FRONTEND_URL)
            if (public.scheme, public.netloc) != (frontend.scheme, frontend.netloc):
                raise ValueError("Use a same-origin frontend/API proxy for session cookies")
        for field in ("GOOGLE_AUTHORIZE_URL", "GOOGLE_TOKEN_URL", "GOOGLE_JWKS_URL",
                      "GITHUB_AUTHORIZE_URL", "GITHUB_TOKEN_URL", "GITHUB_API_URL"):
            if urlsplit(getattr(self, field)).scheme != "https":
                raise ValueError("Provider endpoints must use HTTPS")
        return self

    def credentials(self, provider):
        if provider not in {"google", "github"}:
            raise HTTPException(404, "Unknown provider")
        client_id = getattr(self, provider.upper() + "_CLIENT_ID")
        secret = getattr(self, provider.upper() + "_CLIENT_SECRET")
        if self.missing(provider):
            raise HTTPException(503, "This sign-in provider is not configured")
        return client_id, secret.get_secret_value()

    def missing(self, provider):
        names = [provider.upper() + "_CLIENT_ID", provider.upper() + "_CLIENT_SECRET",
                 "AUTH_PUBLIC_BASE_URL", "AUTH_FRONTEND_URL"]
        missing = []
        for name in names:
            value = getattr(self, name)
            if isinstance(value, SecretStr):
                value = value.get_secret_value()
            if not value or not value.strip():
                missing.append(name)
        return missing

    def callback(self, provider):
        return self.AUTH_PUBLIC_BASE_URL.rstrip("/") + f"/api/auth/oauth/{provider}/callback"


router = APIRouter(prefix="/api/auth/oauth", tags=["OAuth"])
FLOW_COOKIE = "failurelab_oauth"


def load_oauth_settings():
    try:
        return OAuthSettings()
    except ValidationError:
        # Never return/log Pydantic errors: model-level errors can contain secrets.
        raise HTTPException(503, "OAuth URL configuration is invalid. Check the server setup guide.") from None


def provider_readiness(auth_settings):
    result = {"providers": {}, "provider_status": {}, "frontend_origin": None}
    try:
        settings = load_oauth_settings()
    except HTTPException:
        for provider in ("google", "github"):
            result["providers"][provider] = False
            result["provider_status"][provider] = {"reason": "invalid_urls", "missing": []}
        return result
    if settings.AUTH_FRONTEND_URL:
        parsed = urlsplit(settings.AUTH_FRONTEND_URL)
        result["frontend_origin"] = f"{parsed.scheme}://{parsed.netloc}"
    for provider in ("google", "github"):
        missing = settings.missing(provider)
        secure = not settings.AUTH_PUBLIC_BASE_URL or urlsplit(settings.AUTH_PUBLIC_BASE_URL).scheme != "https" or auth_settings.AUTH_COOKIE_SECURE
        reason = "missing_settings" if missing else "secure_cookie_required" if not secure else "configured"
        result["providers"][provider] = reason == "configured"
        result["provider_status"][provider] = {"reason": reason, "missing": missing}
    return result


@router.post("/{provider}/start")
async def start(provider: str, request: Request, response: Response, session: DB, settings: Settings, link: bool = False):
    require_auth_header(request)
    config = load_oauth_settings()
    client_id, _ = config.credentials(provider)
    if urlsplit(config.AUTH_PUBLIC_BASE_URL).scheme == "https" and not settings.AUTH_COOKIE_SECURE:
        raise HTTPException(503, "HTTPS authentication requires secure cookies")
    old_token = request.cookies.get(COOKIE, "")
    link_user = None
    if link:
        link_user = await session.scalar(select(User).join(AuthSession).where(
            AuthSession.token_hash == token_hash(old_token), AuthSession.expires_at > now(),
            User.is_demo.is_(False)))
        if not link_user:
            raise HTTPException(401, "Sign in before linking a provider")
    state, browser, verifier, nonce = (secrets.token_urlsafe(32) for _ in range(4))
    await session.execute(delete(OAuthTransaction).where(OAuthTransaction.expires_at <= now()))
    session.add(OAuthTransaction(state_hash=token_hash(state), browser_hash=token_hash(browser),
        provider=provider, verifier=verifier, nonce=nonce, expires_at=now() + timedelta(minutes=10),
        link_user_id=link_user.id if link_user else None, session_hash=token_hash(old_token) if old_token else None))
    await session.commit()
    # Separate Lax cookie is needed on cross-site provider GET callbacks. The normal session stays Strict.
    response.set_cookie(FLOW_COOKIE, browser, httponly=True, secure=settings.AUTH_COOKIE_SECURE,
                        samesite="lax", max_age=600, path="/")
    response.headers["Cache-Control"] = "no-store"
    params = dict(client_id=client_id, redirect_uri=config.callback(provider), response_type="code",
        state=state, code_challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode(),
        code_challenge_method="S256", scope="openid email profile" if provider == "google" else "read:user user:email")
    if provider == "google":
        params["nonce"] = nonce
    return {"authorization_url": getattr(config, provider.upper() + "_AUTHORIZE_URL") + "?" + urlencode(params)}


async def provider_identity(provider, code, flow, config, http):
    client_id, secret = config.credentials(provider)
    result = await http.post(getattr(config, provider.upper() + "_TOKEN_URL"), data={
        "client_id": client_id, "client_secret": secret, "code": code, "code_verifier": flow.verifier,
        "grant_type": "authorization_code", "redirect_uri": config.callback(provider),
    }, headers={"Accept": "application/json"})
    result.raise_for_status()
    tokens = result.json()
    if tokens.get("error"):
        raise ValueError("Token exchange rejected")
    if provider == "google":
        encoded = tokens["id_token"]
        header = jwt.get_unverified_header(encoded)
        if header.get("alg") != "RS256":
            raise ValueError("Unexpected algorithm")
        keys = await http.get(config.GOOGLE_JWKS_URL)
        keys.raise_for_status()
        matching = [key for key in keys.json()["keys"] if key.get("kid") == header.get("kid")]
        if len(matching) != 1:
            raise ValueError("Unknown signing key")
        key = jwt.PyJWK.from_dict(matching[0], algorithm="RS256").key
        claims = await asyncio.to_thread(jwt.decode, encoded, key, algorithms=["RS256"], audience=client_id,
            issuer=["https://accounts.google.com", "accounts.google.com"],
            options={"require": ["exp", "iat", "iss", "aud", "sub", "nonce"]})
        if not hmac.compare_digest(claims["nonce"], flow.nonce) or claims.get("email_verified") is not True:
            raise ValueError("Unverified identity")
        if claims.get("azp", client_id) != client_id:
            raise ValueError("Wrong authorized party")
        return str(claims["sub"]), claims["email"], claims.get("given_name", "Google"), claims.get("family_name", "")
    headers = {"Authorization": "Bearer " + tokens["access_token"], "Accept": "application/vnd.github+json",
               "X-GitHub-Api-Version": "2022-11-28"}
    profile = await http.get(config.GITHUB_API_URL.rstrip("/") + "/user", headers=headers)
    profile.raise_for_status()
    emails = await http.get(config.GITHUB_API_URL.rstrip("/") + "/user/emails", headers=headers)
    emails.raise_for_status()
    verified = [item for item in emails.json() if item.get("verified") is True]
    if not verified:
        raise ValueError("No verified email")
    verified.sort(key=lambda item: not item.get("primary", False))
    identity = profile.json()
    if not isinstance(identity.get("id"), int):
        raise ValueError("Missing stable GitHub ID")
    names = (identity.get("name") or identity["login"]).split(" ", 1)
    return str(identity["id"]), verified[0]["email"], names[0], names[1] if len(names) > 1 else ""


async def resolve_user(session, provider, identity, flow):
    subject, email, first, last = identity
    if not subject or len(subject) > 255:
        raise ValueError("Invalid provider subject")
    email = email.strip().casefold()
    if not email or len(email) > 254 or "@" not in email:
        raise ValueError("Invalid verified email")
    existing = await session.get(ProviderIdentity, (provider, subject))
    if existing:
        if flow.link_user_id and existing.user_id != flow.link_user_id:
            raise HTTPException(409, "Provider is already linked to another account")
        user = await session.get(User, existing.user_id)
    elif flow.link_user_id:
        user = await session.get(User, flow.link_user_id)
    else:
        if await session.scalar(select(User.id).where(User.email == email)):
            raise HTTPException(409, "Sign in to your existing account and link this provider")
        user = User(id=uuid4(), email=email, first_name=first[:100], last_name=last[:100],
                    password_history=[], failed_login_attempts=0, is_demo=False)
        session.add(user)
        await session.flush()
    if not user or user.is_demo:
        raise ValueError("Account unavailable")
    if not existing:
        session.add(ProviderIdentity(provider=provider, subject=subject, user_id=user.id))
        await session.flush()  # Composite primary key protects concurrent callbacks.
    return user


@router.get("/{provider}/callback")
async def callback(provider: str, request: Request, session: DB, settings: Settings):
    config = load_oauth_settings()
    config.credentials(provider)
    # Only fixed, server-configured destinations. Never reflect provider errors or callback parameters.
    response = RedirectResponse(config.AUTH_FRONTEND_URL, status_code=303)
    response.headers.update({"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})
    response.delete_cookie(FLOW_COOKIE, path="/", samesite="lax")
    failure = "failed"
    try:
        state = request.query_params.get("state", "")
        browser = request.cookies.get(FLOW_COOKIE, "")
        flow = await session.scalar(select(OAuthTransaction).where(
            OAuthTransaction.state_hash == token_hash(state)).with_for_update())
        if (not flow or not browser or flow.provider != provider or flow.expires_at <= now()
            or not hmac.compare_digest(flow.browser_hash, token_hash(browser))):
            raise ValueError("Invalid state")
        # Consume state before network I/O: callback/code can only be used once, even on failures.
        await session.delete(flow)
        await session.commit()
        if flow.link_user_id:
            valid = await session.scalar(select(AuthSession.user_id).where(
                AuthSession.token_hash == flow.session_hash, AuthSession.expires_at > now()))
            if valid != flow.link_user_id:
                raise ValueError("Link session expired")
        if request.query_params.get("error"):
            failure = "cancelled"
            raise ValueError("Consent denied")
        code = request.query_params.get("code")
        if not code or len(code) > 4096:
            raise ValueError("Missing authorization code")
        async with httpx.AsyncClient(timeout=10, trust_env=False, follow_redirects=False) as http:
            identity = await provider_identity(provider, code, flow, config, http)
        user = await resolve_user(session, provider, identity, flow)
        if flow.session_hash:
            await session.execute(delete(AuthSession).where(AuthSession.token_hash == flow.session_hash))
        await create_session(user, session, response, settings)
        return response
    except HTTPException as exc:
        failure = "account_conflict" if exc.status_code == 409 else "failed"
    except IntegrityError:
        failure = "account_conflict"
    except (ValueError, KeyError, TypeError, httpx.HTTPError, jwt.PyJWTError):
        pass
    await session.rollback()
    response.headers["location"] = config.AUTH_FRONTEND_URL.rstrip("/") + "/?auth_error=" + failure
    return response
