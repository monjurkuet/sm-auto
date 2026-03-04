"""Core modules for SM-Auto framework."""

from sm_auto.core.exceptions import (
    SMAutoError,
    BrowserError,
    BrowserLaunchError,
    ProfileError,
    ProfileNotFoundError,
    ProfileLockedError,
    NetworkError,
    NetworkInterceptionError,
    ChallengeDetectedError,
    AutomationError,
    ElementNotFoundError,
    ParserError,
    SessionError,
    RateLimitError,
)

__all__ = [
    "SMAutoError",
    "BrowserError",
    "BrowserLaunchError",
    "ProfileError",
    "ProfileNotFoundError",
    "ProfileLockedError",
    "NetworkError",
    "NetworkInterceptionError",
    "ChallengeDetectedError",
    "AutomationError",
    "ElementNotFoundError",
    "ParserError",
    "SessionError",
    "RateLimitError",
]
