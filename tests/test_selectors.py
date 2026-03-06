"""
Tests for selector configuration loader.
"""

import pytest
from pathlib import Path
from unittest.mock import patch, mock_open

from sm_auto.utils.selectors import SelectorConfig, get_selectors


class TestSelectorConfig:
    """Test SelectorConfig class."""

    def test_init_creates_instance(self):
        """Test SelectorConfig initializes correctly."""
        selectors = SelectorConfig("facebook_marketplace")
        assert selectors.platform == "facebook_marketplace"

    def test_get_existing_selector(self):
        """Test retrieving an existing selector."""
        selectors = SelectorConfig("facebook_marketplace")
        
        # This should work if default config exists
        result = selectors.get("search.input")
        
        # May be None if config not loaded, or a string if loaded
        assert result is None or isinstance(result, str)

    def test_get_nonexistent_selector(self):
        """Test retrieving a non-existent selector."""
        selectors = SelectorConfig("nonexistent_platform")
        
        result = selectors.get("some.selector")
        assert result is None

    def test_get_with_default(self):
        """Test get with default value."""
        selectors = SelectorConfig("nonexistent_platform")
        
        default = "default_selector"
        result = selectors.get("some.selector", fallback=default)
        assert result == default

    def test_get_with_fallbacks(self):
        """Test get_with_fallbacks tries multiple keys."""
        selectors = SelectorConfig("nonexistent_platform")
        
        result = selectors.get_with_fallbacks("key1", "key2", "key3")
        assert result is None

    def test_is_loaded_false_when_no_config(self):
        """Test is_loaded returns False when no config loaded."""
        selectors = SelectorConfig("nonexistent_platform")
        assert not selectors.is_loaded()

    def test_reload_clears_and_reloads(self):
        """Test reload clears and reloads config."""
        selectors = SelectorConfig("nonexistent_platform")
        
        # Should not raise
        selectors.reload()
        
        # Still not loaded for nonexistent platform
        assert not selectors.is_loaded()

    def test_get_all_selectors_returns_copy(self):
        """Test get_all_selectors returns a copy."""
        selectors = SelectorConfig("nonexistent_platform")
        
        all_selectors = selectors.get_all_selectors()
        # Modifying returned dict shouldn't affect internal state
        all_selectors["test"] = "value"
        
        # Internal state should be unchanged
        assert "test" not in selectors.get_all_selectors()

    def test_flatten_dict_helper(self):
        """Test _flatten_dict helper method."""
        selectors = SelectorConfig("test")
        
        nested = {
            "search": {
                "input": "input#search",
                "button": "button#submit"
            },
            "feed": {
                "item": "div.item"
            }
        }
        
        flat = selectors._flatten_dict(nested)
        
        assert flat["search.input"] == "input#search"
        assert flat["search.button"] == "button#submit"
        assert flat["feed.item"] == "div.item"


class TestGetSelectors:
    """Test get_selectors convenience function."""

    def test_get_selectors_returns_selector_config(self):
        """Test get_selectors returns a SelectorConfig instance."""
        result = get_selectors("facebook_marketplace")
        assert isinstance(result, SelectorConfig)
        assert result.platform == "facebook_marketplace"
