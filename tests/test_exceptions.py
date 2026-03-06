"""
Tests for custom exceptions.
"""

import pytest

from sm_auto.core.exceptions import (
    SMAutoError,
    BrowserError,
    BrowserLaunchError,
    ProfileError,
    ProfileNotFoundError,
    ProfileLockedError,
    ChromeInstallationNotFoundError,
    NetworkError,
    NetworkInterceptionError,
    CaptchaError,
    ChallengeDetectedError,
    PlatformError,
    PlatformNotFoundError,
    AutomationError,
    ElementNotFoundError,
    ElementInteractionError,
    ParserError,
    ParseValidationError,
)


class TestExceptionHierarchy:
    """Test exception class hierarchy."""

    def test_smauto_error_is_base(self):
        """Test SMAutoError is the base exception."""
        assert issubclass(BrowserError, SMAutoError)
        assert issubclass(ProfileError, SMAutoError)
        assert issubclass(NetworkError, SMAutoError)
        assert issubclass(CaptchaError, SMAutoError)
        assert issubclass(PlatformError, SMAutoError)
        assert issubclass(AutomationError, SMAutoError)
        assert issubclass(ParserError, SMAutoError)

    def test_browser_exception_hierarchy(self):
        """Test BrowserError subclass relationships."""
        assert issubclass(BrowserLaunchError, BrowserError)

    def test_profile_exception_hierarchy(self):
        """Test ProfileError subclass relationships."""
        assert issubclass(ProfileNotFoundError, ProfileError)
        assert issubclass(ProfileLockedError, ProfileError)
        assert issubclass(ChromeInstallationNotFoundError, ProfileError)

    def test_network_exception_hierarchy(self):
        """Test NetworkError subclass relationships."""
        assert issubclass(NetworkInterceptionError, NetworkError)

    def test_captcha_exception_hierarchy(self):
        """Test CaptchaError subclass relationships."""
        assert issubclass(ChallengeDetectedError, CaptchaError)

    def test_platform_exception_hierarchy(self):
        """Test PlatformError subclass relationships."""
        assert issubclass(PlatformNotFoundError, PlatformError)

    def test_automation_exception_hierarchy(self):
        """Test AutomationError subclass relationships."""
        assert issubclass(ElementNotFoundError, AutomationError)
        assert issubclass(ElementInteractionError, AutomationError)

    def test_parser_exception_hierarchy(self):
        """Test ParserError subclass relationships."""
        assert issubclass(ParseValidationError, ParserError)


class TestExceptionMessages:
    """Test exception messages."""

    def test_exception_with_message(self):
        """Test exceptions can carry messages."""
        msg = "Test error message"
        
        with pytest.raises(SMAutoError) as exc_info:
            raise SMAutoError(msg)
        
        assert str(exc_info.value) == msg

    def test_profile_not_found_distinct_from_installation(self):
        """Test ProfileNotFoundError is distinct from ChromeInstallationNotFoundError."""
        # These should be different exception types
        assert ProfileNotFoundError is not ChromeInstallationNotFoundError
        
        # Both inherit from ProfileError
        assert issubclass(ProfileNotFoundError, ProfileError)
        assert issubclass(ChromeInstallationNotFoundError, ProfileError)
