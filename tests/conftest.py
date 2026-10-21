"""Unit tests must not depend on a developer's private dotenv configuration."""
import pytest


@pytest.fixture(autouse=True)
def isolate_local_dotenv(monkeypatch):
    from services.common.config import BaseAppSettings
    from services.common.authorization import SecuritySettings
    from services.experiment_controller.auth import AuthSettings, get_auth_settings
    from services.experiment_controller.oauth import OAuthSettings
    for settings in (BaseAppSettings, SecuritySettings, AuthSettings, OAuthSettings):
        monkeypatch.setitem(settings.model_config, "env_file", None)
    get_auth_settings.cache_clear()
    yield
    get_auth_settings.cache_clear()
