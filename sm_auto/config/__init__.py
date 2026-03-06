"""
SM-Auto Configuration Package.

Provides configuration management for the SM-Auto framework.
Handles loading and merging configuration from YAML files, environment variables,
and default values.
"""

from sm_auto.utils.config import Settings, get_settings, load_config

__all__ = ["Settings", "get_settings", "load_config"]
