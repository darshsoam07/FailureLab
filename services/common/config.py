"""Environment-only configuration shared by FailureLab services."""

from functools import lru_cache
from typing import Literal

from pydantic import AnyHttpUrl, AmqpDsn, PostgresDsn, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class BaseAppSettings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")

    DATABASE_URL: PostgresDsn
    RABBITMQ_URL: AmqpDsn
    TOXIPROXY_API_URL: AnyHttpUrl = "http://localhost:8474"
    INVENTORY_PROXY_URL: AnyHttpUrl
    LLM_API_KEY: SecretStr | None = None
    USE_MOCK_AI: bool = True
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    @field_validator("DATABASE_URL")
    @classmethod
    def require_asyncpg(cls, value: PostgresDsn) -> PostgresDsn:
        if value.scheme != "postgresql+asyncpg":
            raise ValueError("DATABASE_URL must use the postgresql+asyncpg scheme")
        return value

    @field_validator("LOG_LEVEL", mode="before")
    @classmethod
    def normalize_log_level(cls, value: object) -> object:
        return value.upper() if isinstance(value, str) else value

    @model_validator(mode="after")
    def require_live_ai_key(self) -> "BaseAppSettings":
        if not self.USE_MOCK_AI and (
            self.LLM_API_KEY is None or not self.LLM_API_KEY.get_secret_value().strip()
        ):
            raise ValueError("LLM_API_KEY is required when USE_MOCK_AI is false")
        return self


@lru_cache
def get_settings() -> BaseAppSettings:
    """Load once per process; service-specific settings may subclass the base."""
    return BaseAppSettings()
