"""
Selector Configuration Loader for SM-Auto framework.

Provides dynamic loading of CSS selectors from YAML configuration files,
supporting platform-specific selectors with fallback chains.
"""

from pathlib import Path
from typing import Dict, Any, List, Optional

import yaml

from sm_auto.utils.logger import get_logger

logger = get_logger(__name__)


class SelectorConfig:
    """
    Loads and manages platform-specific CSS selectors from YAML configuration.

    Supports loading from multiple locations with priority:
    1. User config: ~/.sm_auto/{platform}_selectors.yaml
    2. Project config: ./config/{platform}_selectors.yaml
    3. Default config: sm_auto/config/{platform}_selectors.yaml

    Example:
        selectors = SelectorConfig("facebook_marketplace")
        search_input = selectors.get("search.input")
        # Returns: 'input[aria-label="Search Marketplace"]'
    """

    def __init__(self, platform: str, version: Optional[str] = None):
        """
        Initialize selector configuration for a platform.

        Args:
            platform: Platform name (e.g., 'facebook_marketplace')
            version: Optional version requirement (not yet enforced)
        """
        self.platform = platform
        self.version = version
        self._config: Dict[str, Any] = {}
        self._selectors: Dict[str, str] = {}
        self._api_patterns: Dict[str, str] = {}
        self._fallbacks: Dict[str, List[str]] = {}

        self._load_config()

    def _load_config(self) -> None:
        """Load configuration from files with priority order."""
        config_files = self._get_config_paths()

        for config_path in config_files:
            if config_path.exists():
                try:
                    with open(config_path, "r", encoding="utf-8") as f:
                        self._config = yaml.safe_load(f)

                    # Flatten selectors into dot-notation dict
                    self._selectors = self._flatten_dict(
                        self._config.get("selectors", {})
                    )
                    self._api_patterns = self._config.get("api_patterns", {})
                    self._fallbacks = self._config.get("fallbacks", {})

                    logger.debug(
                        f"Loaded {len(self._selectors)} selectors from {config_path}"
                    )
                    return

                except yaml.YAMLError as e:
                    logger.warning(f"Failed to parse {config_path}: {e}")
                except IOError as e:
                    logger.debug(f"Could not read {config_path}: {e}")

        logger.warning(f"No selector config found for platform: {self.platform}")

    def _get_config_paths(self) -> List[Path]:
        """Get list of config file paths in priority order."""
        # Map platform names to config filenames
        platform_to_file = {
            "facebook_marketplace": "facebook_selectors.yaml",
            "facebook": "facebook_selectors.yaml",
            "instagram": "instagram_selectors.yaml",
            "tiktok": "tiktok_selectors.yaml",
        }
        filename = platform_to_file.get(self.platform, f"{self.platform}_selectors.yaml")

        return [
            # User config (highest priority)
            Path.home() / ".sm_auto" / filename,
            # Project config
            Path.cwd() / "config" / filename,
            # Default config (lowest priority)
            Path(__file__).parent.parent / "config" / filename,
        ]

    def _flatten_dict(
        self,
        nested: Dict[str, Any],
        parent_key: str = "",
        sep: str = ".",
    ) -> Dict[str, str]:
        """
        Flatten nested dictionary to dot-notation keys.

        Args:
            nested: Nested dictionary
            parent_key: Parent key for recursion
            sep: Separator for keys

        Returns:
            Flattened dictionary
        """
        items: Dict[str, str] = {}
        for key, value in nested.items():
            new_key = f"{parent_key}{sep}{key}" if parent_key else key
            if isinstance(value, dict):
                items.update(self._flatten_dict(value, new_key, sep))
            else:
                items[new_key] = str(value)
        return items

    def get(self, key: str, fallback: Optional[str] = None) -> Optional[str]:
        """
        Get a selector by key.

        Args:
            key: Dot-notation key (e.g., 'search.input')
            fallback: Value to return if key not found

        Returns:
            Selector string or fallback value
        """
        # Try primary key
        if key in self._selectors:
            return self._selectors[key]

        # Try configured fallbacks
        if key in self._fallbacks:
            for fallback_key in self._fallbacks[key]:
                value = self.get(fallback_key)
                if value:
                    logger.debug(f"Using fallback '{fallback_key}' for '{key}'")
                    return value

        return fallback

    def get_with_fallbacks(self, *keys: str) -> Optional[str]:
        """
        Try multiple selector keys and return first match.

        Args:
            *keys: Variable number of selector keys to try

        Returns:
            First matching selector or None
        """
        for key in keys:
            selector = self.get(key)
            if selector:
                return selector
        return None

    def get_api_pattern(self, name: str) -> Optional[str]:
        """
        Get an API URL pattern by name.

        Args:
            name: Pattern name (e.g., 'graphql')

        Returns:
            API pattern string or None
        """
        return self._api_patterns.get(name)

    def get_api_patterns(self) -> Dict[str, str]:
        """
        Get all API URL patterns.

        Returns:
            Dictionary of all API patterns
        """
        return self._api_patterns.copy()

    def get_all_selectors(self) -> Dict[str, str]:
        """
        Get all loaded selectors.

        Returns:
            Dictionary of all selectors
        """
        return self._selectors.copy()

    def is_loaded(self) -> bool:
        """
        Check if configuration was successfully loaded.

        Returns:
            True if config was loaded, False otherwise
        """
        return bool(self._config)

    def get_version(self) -> Optional[str]:
        """
        Get the version of the loaded configuration.

        Returns:
            Version string or None
        """
        return self._config.get("version")

    def reload(self) -> None:
        """Reload configuration from files."""
        self._config = {}
        self._selectors = {}
        self._api_patterns = {}
        self._fallbacks = {}
        self._load_config()


# Convenience function for common use case
def get_selectors(platform: str) -> SelectorConfig:
    """
    Get selector configuration for a platform.

    Args:
        platform: Platform name (e.g., 'facebook_marketplace')

    Returns:
        SelectorConfig instance
    """
    return SelectorConfig(platform)
