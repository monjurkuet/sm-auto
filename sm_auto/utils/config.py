"""
Configuration management for SM-Auto framework.

Provides Pydantic-based settings with YAML configuration file support
and environment variable overrides.
"""

import os
from pathlib import Path
from typing import Optional, Dict, Any, List

import yaml
from pydantic import BaseModel, Field


class BrowserConfig(BaseModel):
    """Browser configuration settings."""

    headless: bool = Field(
        default=False,
        description="Run browser in headless mode (must be false for manual CAPTCHA handling)",
    )
    window_width: int = Field(default=1920, description="Browser window width")
    window_height: int = Field(default=1080, description="Browser window height")
    user_agent: Optional[str] = Field(
        default=None,
        description="Custom user agent string (None uses nodriver default)",
    )
    extra_args: List[str] = Field(
        default_factory=list,
        description="Additional Chrome command-line arguments",
    )


class ProfileConfig(BaseModel):
    """Chrome profile configuration settings."""

    chrome_user_data_dir: Optional[str] = Field(
        default=None,
        description="Custom Chrome User Data directory path (auto-detected if None)",
    )


class DelayConfig(BaseModel):
    """Human-like delay configuration settings."""

    wpm: int = Field(default=60, description="Typing speed in words per minute")
    micro_delay_min: float = Field(
        default=0.08, description="Minimum micro delay in seconds"
    )
    micro_delay_max: float = Field(
        default=0.20, description="Maximum micro delay in seconds"
    )
    action_delay_min: float = Field(
        default=0.5, description="Minimum action delay in seconds"
    )
    action_delay_max: float = Field(
        default=2.5, description="Maximum action delay in seconds"
    )
    task_delay_min: float = Field(
        default=2.0, description="Minimum task delay in seconds"
    )
    task_delay_max: float = Field(
        default=8.0, description="Maximum task delay in seconds"
    )
    page_delay_min: float = Field(
        default=1.5, description="Minimum page load delay in seconds"
    )
    page_delay_max: float = Field(
        default=4.0, description="Maximum page load delay in seconds"
    )
    reading_pause_min: float = Field(
        default=3.0, description="Minimum reading pause in seconds"
    )
    reading_pause_max: float = Field(
        default=12.0, description="Maximum reading pause in seconds"
    )


class NetworkConfig(BaseModel):
    """Network interception configuration settings."""

    interception_enabled: bool = Field(
        default=True, description="Enable network interception"
    )
    filters: List[str] = Field(
        default_factory=lambda: ["graphql", "api", "ajax"],
        description="URL patterns to filter for interception",
    )
    ignored_mimes: List[str] = Field(
        default_factory=lambda: ["image/", "text/css", "font/", "application/font"],
        description="MIME types to ignore during interception",
    )


class PlatformConfig(BaseModel):
    """Platform-specific configuration settings."""

    base_url: str
    login_timeout: int = Field(default=120, description="Login timeout in seconds")
    max_scrolls: int = Field(default=15, description="Maximum scroll iterations for lazy loading")


class PlatformsConfig(BaseModel):
    """All platforms configuration."""

    facebook: PlatformConfig = Field(
        default_factory=lambda: PlatformConfig(
            base_url="https://www.facebook.com", login_timeout=120, max_scrolls=15
        )
    )
    instagram: PlatformConfig = Field(
        default_factory=lambda: PlatformConfig(
            base_url="https://www.instagram.com", login_timeout=120
        )
    )
    tiktok: PlatformConfig = Field(
        default_factory=lambda: PlatformConfig(
            base_url="https://www.tiktok.com", login_timeout=120
        )
    )


class JSONStorageConfig(BaseModel):
    """JSON file storage configuration."""
    enabled: bool = Field(default=True)
    output_dir: str = Field(default="./output")
    filename_template: str = Field(default="{platform}_{query}_{timestamp}.json")


class MongoDBStorageConfig(BaseModel):
    """MongoDB storage configuration."""
    enabled: bool = Field(default=False)
    database: str = Field(default="sm_auto")
    collection: str = Field(default="facebook_marketplace")


class StorageConfig(BaseModel):
    """Data storage configuration."""
    default_format: str = Field(default="json")
    json_config: JSONStorageConfig = Field(default_factory=JSONStorageConfig)
    mongodb: MongoDBStorageConfig = Field(default_factory=MongoDBStorageConfig)


class LoggingConfig(BaseModel):
    """Logging configuration."""
    level: str = Field(default="INFO")
    output: str = Field(default="console")
    log_dir: str = Field(default="./logs")
    enabled_modules: List[str] = Field(default_factory=list)
    disabled_modules: List[str] = Field(default_factory=list)
    format: str = Field(default="simple")


class Settings(BaseModel):
    """Main settings class for SM-Auto framework."""

    browser: BrowserConfig = Field(default_factory=BrowserConfig)
    profiles: ProfileConfig = Field(default_factory=ProfileConfig)
    delays: DelayConfig = Field(default_factory=DelayConfig)
    network: NetworkConfig = Field(default_factory=NetworkConfig)
    platforms: PlatformsConfig = Field(default_factory=PlatformsConfig)
    storage: StorageConfig = Field(default_factory=StorageConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)

    class Config:
        extra = "ignore"
        validate_assignment = True


def load_yaml_config(config_path: Path) -> Dict[str, Any]:
    """
    Load configuration from a YAML file.

    Args:
        config_path: Path to the YAML configuration file.

    Returns:
        Dictionary containing configuration values.
    """
    if not config_path.exists():
        return {}

    with open(config_path, "r") as f:
        config = yaml.safe_load(f)

    return config or {}


def load_config(
    config_file: Optional[Path] = None,
    env_prefix: str = "SMAUTO_",
    dotenv_path: Optional[Path] = None,
) -> Settings:
    """
    Load configuration from YAML file with environment variable overrides.

    Environment variables should be prefixed with SMAUTO_ and use double
    underscores for nested keys. For example:
        - SMAUTO_BROWSER_HEADLESS=true
        - SMAUTO_DELAYS_WPM=80

    Args:
        config_file: Path to YAML configuration file. If None, uses default location.
        env_prefix: Prefix for environment variable overrides.
        dotenv_path: Path to .env file. If None, uses default .env in current directory.

    Returns:
        Validated Settings object.
    """
    # Load .env file first (lowest priority)
    try:
        from dotenv import load_dotenv
        env_file = dotenv_path or Path(".env")
        if env_file.exists():
            load_dotenv(env_file)
    except ImportError:
        pass  # python-dotenv not installed

    # Determine config file path - only use default_config.yaml
    if config_file is None:
        config_file = Path(__file__).parent.parent / "config" / "default_config.yaml"

    # Load YAML config
    yaml_config = load_yaml_config(config_file) if config_file.exists() else {}

    # Override with environment variables
    env_config = _load_env_config(env_prefix)

    # Merge configurations (env takes precedence)
    merged_config = _deep_merge(yaml_config, env_config)

    # Create and return Settings object
    return Settings(**merged_config)


def _load_env_config(prefix: str) -> Dict[str, Any]:
    """
    Load configuration from environment variables.

    Args:
        prefix: Environment variable prefix.

    Returns:
        Dictionary containing configuration from environment variables.
    """
    config = {}

    for key, value in os.environ.items():
        if not key.startswith(prefix):
            continue

        # Remove prefix and convert to lowercase
        config_key = key[len(prefix) :].lower()

        # Parse nested keys (double underscore)
        keys = config_key.split("__")

        # Convert value to appropriate type
        parsed_value = _parse_env_value(value)

        # Build nested dictionary
        current = config
        for k in keys[:-1]:
            if k not in current:
                current[k] = {}
            current = current[k]
        current[keys[-1]] = parsed_value

    return config


def _parse_env_value(value: str) -> Any:
    """
    Parse environment variable value to appropriate Python type.

    Args:
        value: String value from environment variable.

    Returns:
        Parsed value (bool, int, float, or str).
    """
    # Boolean
    if value.lower() in ("true", "yes", "1", "on"):
        return True
    if value.lower() in ("false", "no", "0", "off"):
        return False

    # Integer
    try:
        return int(value)
    except ValueError:
        pass

    # Float
    try:
        return float(value)
    except ValueError:
        pass

    # String (default)
    return value


def _deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """
    Deep merge two dictionaries, with override taking precedence.

    Args:
        base: Base dictionary.
        override: Dictionary with override values.

    Returns:
        Merged dictionary.
    """
    result = base.copy()

    for key, value in override.items():
        if (
            key in result
            and isinstance(result[key], dict)
            and isinstance(value, dict)
        ):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value

    return result


# Global settings instance (lazy-loaded)
_settings: Optional[Settings] = None


def get_settings() -> Settings:
    """
    Get the global settings instance.

    Returns:
        Settings object.
    """
    global _settings
    if _settings is None:
        _settings = load_config()
    return _settings


def reload_settings(config_file: Optional[Path] = None) -> Settings:
    """
    Reload settings from configuration file.

    Args:
        config_file: Optional path to configuration file.

    Returns:
        Reloaded Settings object.
    """
    global _settings
    _settings = load_config(config_file)
    return _settings
