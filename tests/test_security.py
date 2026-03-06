"""
Tests for security utilities.
"""

import pytest
from pathlib import Path
from unittest.mock import patch

from sm_auto.utils.security import (
    validate_profile_path,
    sanitize_browser_args,
    sanitize_url_for_logging,
    is_safe_path_component,
)
from sm_auto.core.exceptions import ProfileNotFoundError


class TestPathValidation:
    """Test path validation security features."""

    def test_validate_existing_path(self, tmp_path):
        """Test validating an existing path."""
        test_dir = tmp_path / "test_profile"
        test_dir.mkdir()
        
        # Allow tmp_path as base
        result = validate_profile_path(test_dir, allowed_base_dirs=[tmp_path])
        assert result == test_dir.resolve()

    def test_validate_nonexistent_path(self, tmp_path):
        """Test validating a non-existent path raises error."""
        test_dir = tmp_path / "nonexistent"
        
        with pytest.raises(ProfileNotFoundError):
            validate_profile_path(test_dir, allowed_base_dirs=[tmp_path])

    def test_validate_file_not_directory(self, tmp_path):
        """Test validating a file (not directory) raises error."""
        test_file = tmp_path / "file.txt"
        test_file.write_text("test")
        
        with pytest.raises(ProfileNotFoundError):
            validate_profile_path(test_file, allowed_base_dirs=[tmp_path])

    def test_path_traversal_blocked(self, tmp_path):
        """Test that path traversal is blocked."""
        # Try to access parent directory
        test_dir = tmp_path / "test_profile"
        test_dir.mkdir()
        
        with pytest.raises(ValueError) as exc_info:
            validate_profile_path(
                test_dir / ".." / ".." / "etc",
                allowed_base_dirs=[test_dir]
            )
        
        assert "path traversal" in str(exc_info.value).lower() or "outside allowed" in str(exc_info.value).lower()

    def test_invalid_type_raises_error(self):
        """Test that invalid types raise TypeError."""
        with pytest.raises(TypeError):
            validate_profile_path(12345, allowed_base_dirs=[Path("/tmp")])


class TestBrowserArgsSanitization:
    """Test browser arguments sanitization."""

    def test_sanitize_password_arg(self):
        """Test password arguments are sanitized."""
        args = [
            "--headless",
            "--password=secret123",
            "--window-size=1920,1080"
        ]
        
        result = sanitize_browser_args(args)
        
        assert "--password=***REDACTED***" in result
        assert "secret123" not in str(result)

    def test_sanitize_token_arg(self):
        """Test token arguments are sanitized."""
        args = [
            "--token=abc123xyz",
            "--api-key=mykey123"
        ]
        
        result = sanitize_browser_args(args)
        
        assert "--token=***REDACTED***" in result
        assert "abc123xyz" not in str(result)

    def test_sanitize_api_key_arg(self):
        """Test API key arguments are sanitized."""
        args = ["--api-key=secret_key_123"]
        
        result = sanitize_browser_args(args)
        
        assert "--api-key=***REDACTED***" in result
        assert "secret_key_123" not in str(result)

    def test_safe_args_unchanged(self):
        """Test safe arguments are not modified."""
        args = [
            "--headless",
            "--window-size=1920,1080",
            "--disable-gpu"
        ]
        
        result = sanitize_browser_args(args)
        
        assert result == args


class TestUrlSanitization:
    """Test URL sanitization."""

    def test_sanitize_token_in_url(self):
        """Test token parameter is sanitized in URL."""
        url = "https://api.example.com/data?token=secret123&user=john"
        
        result = sanitize_url_for_logging(url)
        
        assert "token=***REDACTED***" in result
        assert "secret123" not in result
        assert "user=john" in result

    def test_sanitize_api_key_in_url(self):
        """Test API key parameter is sanitized in URL."""
        url = "https://api.example.com?api_key=mykey&format=json"
        
        result = sanitize_url_for_logging(url)
        
        assert "api_key=***REDACTED***" in result
        assert "mykey" not in result

    def test_safe_url_unchanged(self):
        """Test URL without sensitive params is unchanged."""
        url = "https://example.com/page?category=books&sort=price"
        
        result = sanitize_url_for_logging(url)
        
        assert result == url

    def test_custom_sensitive_params(self):
        """Test custom sensitive parameter list."""
        url = "https://api.example.com?custom_secret=value&other=data"
        
        result = sanitize_url_for_logging(url, mask_query_params=["custom_secret"])
        
        assert "custom_secret=***REDACTED***" in result


class TestSafePathComponent:
    """Test safe path component checking."""

    def test_safe_component(self):
        """Test valid path components are safe."""
        assert is_safe_path_component("valid_name") is True
        assert is_safe_path_component("Profile 1") is True

    def test_traversal_component(self):
        """Test traversal sequences are detected."""
        assert is_safe_path_component("..") is False
        assert is_safe_path_component("../etc") is False

    def test_empty_component(self):
        """Test empty component is unsafe."""
        assert is_safe_path_component("") is False
