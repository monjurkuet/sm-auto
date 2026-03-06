"""
Custom exceptions for SM-Auto framework.

Provides a hierarchy of exceptions for better error handling
and more specific error messages throughout the framework.
"""


class SMAutoError(Exception):
    """Base exception for all SM-Auto errors."""

    pass


class BrowserError(SMAutoError):
    """Base exception for browser-related errors."""

    pass


class BrowserLaunchError(BrowserError):
    """Raised when browser fails to launch."""

    pass


class ProfileError(SMAutoError):
    """Base exception for profile-related errors."""

    pass


class ProfileNotFoundError(ProfileError):
    """Raised when a requested Chrome profile is not found within a Chrome installation."""

    pass


class ProfileLockedError(ProfileError):
    """Raised when attempting to use a profile that is in use by another Chrome instance."""

    pass


class ProfileCopyError(ProfileError):
    """Raised when profile copy operation fails."""

    pass


class ChromeInstallationNotFoundError(ProfileError):
    """
    Raised when Chrome browser installation cannot be found on the system.

    This is distinct from ProfileNotFoundError which is raised when a specific
    profile cannot be found within an existing Chrome installation.
    """

    pass


class NetworkError(SMAutoError):
    """Base exception for network-related errors."""

    pass


class NetworkInterceptionError(NetworkError):
    """Raised when network interception fails."""

    pass


class CaptchaError(SMAutoError):
    """Base exception for CAPTCHA/challenge-related errors."""

    pass


class ChallengeDetectedError(CaptchaError):
    """Raised when a CAPTCHA or security challenge is detected."""

    pass


class PlatformError(SMAutoError):
    """Base exception for platform-specific errors."""

    pass


class PlatformNotFoundError(PlatformError):
    """Raised when a requested platform is not supported."""

    pass


class AutomationError(SMAutoError):
    """Base exception for automation-related errors."""

    pass


class ElementNotFoundError(AutomationError):
    """Raised when a required DOM element is not found."""

    pass


class ElementInteractionError(AutomationError):
    """Raised when interaction with a DOM element fails."""

    pass


class ParserError(SMAutoError):
    """Base exception for parsing errors."""

    pass


class ParseValidationError(ParserError):
    """Raised when parsed data fails validation."""

    pass


class ConfigurationError(SMAutoError):
    """Base exception for configuration-related errors."""

    pass


class SessionError(SMAutoError):
    """Base exception for session-related errors."""

    pass


class SessionExpiredError(SessionError):
    """Raised when a session has expired and needs re-authentication."""

    pass


class RateLimitError(SMAutoError):
    """Raised when rate limiting is detected."""

    pass
