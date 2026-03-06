"""
Tests for Profile Manager module.

Tests profile discovery, validation, and management functionality.
"""

import asyncio
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock, mock_open

import pytest

from sm_auto.core.browser.profile_manager import (
    ProfileManager,
    ChromeProfile,
    ChromeUserDataDir,
)
from sm_auto.core.exceptions import ProfileNotFoundError, ProfileLockedError


class TestChromeProfile:
    """Tests for ChromeProfile dataclass."""

    def test_profile_creation(self):
        """Test creating a ChromeProfile instance."""
        profile = ChromeProfile(
            name="Profile 1",
            path=Path("/tmp/chrome/Profile 1"),
            is_default=False,
            display_name="Test Profile",
            email="test@example.com",
        )

        assert profile.name == "Profile 1"
        assert profile.path == Path("/tmp/chrome/Profile 1")
        assert not profile.is_default
        assert profile.display_name == "Test Profile"
        assert profile.email == "test@example.com"

    def test_profile_str_representation(self):
        """Test string representation of ChromeProfile."""
        profile = ChromeProfile(
            name="Default",
            path=Path("/tmp/chrome/Default"),
            is_default=True,
            display_name="Person 1",
            email="user@example.com",
        )

        str_repr = str(profile)
        assert "Person 1" in str_repr
        assert "user@example.com" in str_repr
        assert "[DEFAULT]" in str_repr

    def test_profile_str_without_email(self):
        """Test string representation without email."""
        profile = ChromeProfile(
            name="Profile 1",
            path=Path("/tmp/chrome/Profile 1"),
        )

        str_repr = str(profile)
        assert "Profile 1" in str_repr
        assert "(" not in str_repr  # No email means no parentheses


class TestProfileManagerInitialization:
    """Tests for ProfileManager initialization."""

    def test_init_with_custom_user_data_dir(self):
        """Test initialization with custom user data directory."""
        custom_path = Path("/custom/chrome/path")
        manager = ProfileManager(user_data_dir=custom_path)

        assert manager.user_data_dir == custom_path

    def test_init_without_user_data_dir(self):
        """Test initialization without custom directory."""
        manager = ProfileManager()

        assert manager.user_data_dir is None


class TestProfileDiscoveryAsync:
    """Tests for async profile discovery."""

    @pytest.fixture
    def temp_chrome_dir(self):
        """Create a temporary Chrome user data directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            chrome_dir = Path(tmpdir) / "chrome"
            chrome_dir.mkdir()

            # Create profile directories
            profile1 = chrome_dir / "Profile 1"
            profile1.mkdir()

            # Create Preferences file
            prefs = {
                "profile": {
                    "name": "Person 1",
                    "email": "person1@example.com",
                    "last_used": "2024-01-01T00:00:00Z",
                }
            }
            (profile1 / "Preferences").write_text(json.dumps(prefs))

            yield chrome_dir

    @pytest.mark.asyncio
    async def test_discover_profiles_async(self, temp_chrome_dir):
        """Test async profile discovery."""
        manager = ProfileManager(user_data_dir=temp_chrome_dir)

        profiles = await manager.discover_profiles()

        assert len(profiles) == 1
        assert profiles[0].name == "Profile 1"
        assert profiles[0].display_name == "Person 1"
        assert profiles[0].email == "person1@example.com"

    @pytest.mark.asyncio
    async def test_discover_profiles_no_chrome_dir(self):
        """Test discovery when Chrome directory doesn't exist."""
        manager = ProfileManager(user_data_dir=Path("/nonexistent/path"))

        with pytest.raises(ProfileNotFoundError):
            await manager.discover_profiles()

    @pytest.mark.asyncio
    async def test_discover_profiles_empty_directory(self, temp_chrome_dir):
        """Test discovery in empty directory."""
        # Remove the profile we created
        (temp_chrome_dir / "Profile 1").rmdir()

        manager = ProfileManager(user_data_dir=temp_chrome_dir)
        profiles = await manager.discover_profiles()

        assert len(profiles) == 0


class TestProfileDiscoverySync:
    """Tests for synchronous profile discovery."""

    @pytest.fixture
    def temp_chrome_dir(self):
        """Create a temporary Chrome user data directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            chrome_dir = Path(tmpdir) / "chrome"
            chrome_dir.mkdir()

            # Create profile directory
            profile1 = chrome_dir / "Profile 1"
            profile1.mkdir()

            # Create Preferences file
            prefs = {"profile": {"name": "Test User"}}
            (profile1 / "Preferences").write_text(json.dumps(prefs))

            yield chrome_dir

    def test_discover_profiles_sync(self, temp_chrome_dir):
        """Test synchronous profile discovery."""
        manager = ProfileManager(user_data_dir=temp_chrome_dir)

        profiles = manager.discover_profiles_sync()

        assert len(profiles) == 1
        assert profiles[0].name == "Profile 1"

    def test_discover_profiles_sync_in_async_context(self, temp_chrome_dir):
        """Test sync discovery when already in async context."""

        async def run_test():
            manager = ProfileManager(user_data_dir=temp_chrome_dir)
            profiles = manager.discover_profiles_sync()
            assert len(profiles) == 1

        asyncio.run(run_test())


class TestProfileValidation:
    """Tests for profile validation."""

    @pytest.fixture
    def temp_profile(self):
        """Create a temporary profile directory."""
        with tempfile.TemporaryDirectory() as tmpdir:
            profile_dir = Path(tmpdir) / "TestProfile"
            profile_dir.mkdir()

            profile = ChromeProfile(
                name="TestProfile",
                path=profile_dir,
            )

            yield profile

    @pytest.mark.asyncio
    async def test_verify_profile_valid(self, temp_profile):
        """Test verifying a valid profile."""
        manager = ProfileManager()

        # Create a lock file to simulate locked profile
        lock_file = temp_profile.path / "SingletonLock"
        lock_file.write_text("")

        result = await manager.verify_profile(temp_profile)

        assert result is True

    @pytest.mark.asyncio
    async def test_verify_profile_not_found(self):
        """Test verifying a non-existent profile."""
        manager = ProfileManager()

        profile = ChromeProfile(
            name="NonExistent",
            path=Path("/nonexistent/profile"),
        )

        with pytest.raises(ProfileNotFoundError):
            await manager.verify_profile(profile)


class TestReadPreferencesAsync:
    """Tests for async preferences reading."""

    @pytest.mark.asyncio
    async def test_read_preferences_valid(self):
        """Test reading valid preferences file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            prefs_file = Path(tmpdir) / "Preferences"
            prefs_data = {"profile": {"name": "Test"}}
            prefs_file.write_text(json.dumps(prefs_data))

            manager = ProfileManager()
            result = await manager._read_preferences_async(prefs_file)

            assert result == prefs_data

    @pytest.mark.asyncio
    async def test_read_preferences_file_not_found(self):
        """Test reading non-existent preferences file."""
        manager = ProfileManager()
        result = await manager._read_preferences_async(Path("/nonexistent"))

        assert result is None

    @pytest.mark.asyncio
    async def test_read_preferences_invalid_json(self):
        """Test reading invalid JSON."""
        with tempfile.TemporaryDirectory() as tmpdir:
            prefs_file = Path(tmpdir) / "Preferences"
            prefs_file.write_text("invalid json")

            manager = ProfileManager()
            result = await manager._read_preferences_async(prefs_file)

            assert result is None


class TestChromeUserDataDir:
    """Tests for ChromeUserDataDir dataclass."""

    def test_user_data_dir_creation(self):
        """Test creating ChromeUserDataDir instance."""
        profiles = [
            ChromeProfile(name="Profile 1", path=Path("/tmp/p1")),
            ChromeProfile(name="Profile 2", path=Path("/tmp/p2")),
        ]

        user_data_dir = ChromeUserDataDir(
            path=Path("/tmp/chrome"),
            is_default=True,
            browser_name="Chrome Beta",
            profiles=profiles,
        )

        assert user_data_dir.path == Path("/tmp/chrome")
        assert user_data_dir.is_default
        assert user_data_dir.browser_name == "Chrome Beta"
        assert len(user_data_dir.profiles) == 2

    def test_user_data_dir_default_values(self):
        """Test default values for ChromeUserDataDir."""
        user_data_dir = ChromeUserDataDir(path=Path("/tmp/chrome"))

        assert not user_data_dir.is_default
        assert user_data_dir.browser_name == "Chrome"
        assert user_data_dir.profiles == []
