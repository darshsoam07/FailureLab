"""Async PostgreSQL lifecycle and transaction-scoped FastAPI sessions."""

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention={
        "ix": "ix_%(table_name)s_%(column_0_name)s",
        "uq": "uq_%(table_name)s_%(column_0_name)s",
        "ck": "ck_%(table_name)s_%(constraint_name)s",
        "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
        "pk": "pk_%(table_name)s",
    })


@lru_cache
def get_engine() -> AsyncEngine:
    """Create a process-local engine on first use, without connecting yet."""
    return create_async_engine(str(get_settings().DATABASE_URL), pool_pre_ping=True)


@lru_cache
def get_session_factory() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False, autoflush=False)


async def get_db_session() -> AsyncIterator[AsyncSession]:
    """Services explicitly commit; failures and uncommitted work roll back."""
    async with get_session_factory()() as session:
        try:
            yield session
        except BaseException:
            await session.rollback()
            raise


async def init_db() -> None:
    """Create missing tables at startup; existing schemas need migrations."""
    from . import models  # noqa: F401 -- register every table before create_all

    async with get_engine().begin() as connection:
        # Serialize concurrent service startups, including PostgreSQL enum DDL.
        from sqlalchemy import text

        await connection.execute(text("SELECT pg_advisory_xact_lock(721148320041)"))
        await connection.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    """Dispose at shutdown, after all request/background sessions have closed."""
    if get_engine.cache_info().currsize:
        await get_engine().dispose()
    get_session_factory.cache_clear()
    get_engine.cache_clear()
