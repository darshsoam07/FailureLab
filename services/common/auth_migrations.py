"""Versioned, additive auth migrations, serialized by the caller's advisory lock."""
from sqlalchemy import text
from .models import ProviderIdentity, OAuthTransaction, OperatorRole


async def migrate_auth(connection):
    await connection.execute(text(
        "CREATE TABLE IF NOT EXISTS auth_schema_versions "
        "(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"))
    applied = await connection.scalar(text("SELECT version FROM auth_schema_versions WHERE version=1"))
    if applied is None:
        for model in (ProviderIdentity, OAuthTransaction, OperatorRole):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn, checkfirst=True))
        await connection.execute(text("INSERT INTO auth_schema_versions(version) VALUES (1)"))
