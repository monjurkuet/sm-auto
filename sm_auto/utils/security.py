"""
Security utilities for SM-Auto framework.

Provides functions for input validation, path sanitization, and safe logging
to prevent security vulnerabilities.
"""

import re
from pathlib import Path
from typing import List, Optional, Union

from sm_auto.core.exceptions import ProfileNotFoundError


# Common Chrome user data directory locations by OS
DEFAULT_ALLOWED_BASE_DIRS = [
    # Linux
    Path.home() / ".config" / "google-chrome",
    Path.home() / ".config" / "chromium",
    Path.home() / ".config" / "google-chrome-beta",
    Path.home() / ".config" / "microsoft-edge",
    Path.home() / ".config" / "BraveSoftware",
    # macOS
    Path.home() / "Library" / "Application Support" / "Google" / "Chrome",
    Path.home() / "Library" / "Application Support" / "Chromium",
    Path.home() / "Library" / "Application Support" / "Google" / "Chrome Beta",
    Path.home() / "Library" / "Application Support" / "Microsoft Edge",
    # Windows
    Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "User Data",
    Path.home() / "AppData" / "Local" / "Microsoft" / "Edge" / "User Data",
    Path.home() / "AppData" / "Local" / "BraveSoftware" / "Brave-Browser",
]


def validate_profile_path(
    path: Union[str, Path],
    allowed_base_dirs: Optional[List[Path]] = None,
) -> Path:
    """
    Validate that a profile path is safe to use.

    Ensures the path:
    - Exists and is a directory
    - Is within an allowed base directory (prevents path traversal)
    - Is a valid Chrome profile path

    Args:
        path: The path to validate (string or Path object)
        allowed_base_dirs: List of allowed base directories.
                          If None, uses DEFAULT_ALLOWED_BASE_DIRS.

    Returns:
        The resolved Path object if valid

    Raises:
        ProfileNotFoundError: If path does not exist or is not a directory
        ValueError: If path is outside allowed directories (path traversal attempt)
        TypeError: If path is not a string or Path object
    """
    # Type validation
    if not isinstance(path, (str, Path)):
        raise TypeError(f"Path must be str or Path, got {type(path).__name__}")

    # Convert to Path and resolve
    path_obj = Path(path).expanduser().resolve()

    # Check existence
    if not path_obj.exists():
        raise ProfileNotFoundError(f"Path does not exist: {path}")

    # Check if directory
    if not path_obj.is_dir():
        raise ProfileNotFoundError(f"Path is not a directory: {path}")

    # Use default allowed directories if not specified
    check_dirs = allowed_base_dirs or DEFAULT_ALLOWED_BASE_DIRS

    # Check if path is within allowed directories
    is_allowed = False
    for allowed_dir in check_dirs:
        try:
            # Resolve the allowed dir too (in case it contains symlinks)
            resolved_allowed = allowed_dir.expanduser().resolve()
            if resolved_allowed.exists():
                # Check if path is within allowed directory
                path_obj.relative_to(resolved_allowed)
                is_allowed = True
                break
        except ValueError:
            # path_obj is not relative to allowed_dir
            continue

    if not is_allowed:
        raise ValueError(
            f"Path '{path}' is outside allowed Chrome directories. "
            f"Profile paths must be within standard Chrome user data directories. "
            f"This is a security measure to prevent path traversal attacks."
        )

    return path_obj


def is_safe_path_component(name: str) -> bool:
    """
    Check if a path component is safe (doesn't contain traversal sequences).

    Args:
        name: The path component to check

    Returns:
        True if safe, False otherwise
    """
    if not name:
        return False

    # Check for path traversal patterns
    dangerous_patterns = [
        "..",  # Parent directory
        "~",  # Home directory expansion (already handled, but double-check)
        "/",  # Path separator (should be single component)
        "\\",  # Windows path separator
        "\x00",  # Null byte
    ]

    for pattern in dangerous_patterns:
        if pattern in name:
            return False

    return True


# Patterns for sensitive data that should be sanitized from logs
SENSITIVE_PATTERNS = [
    (re.compile(r'(--password=)[^\s]+', re.IGNORECASE), r'\1***REDACTED***'),
    (re.compile(r'(--token=)[^\s]+', re.IGNORECASE), r'\1***REDACTED***'),
    (re.compile(r'(--secret=)[^\s]+', re.IGNORECASE), r'\1***REDACTED***'),
    (re.compile(r'(--api-key=)[^\s]+', re.IGNORECASE), r'\1***REDACTED***'),
    (re.compile(r'(--key=)[^\s]+', re.IGNORECASE), r'\1***REDACTED***'),
    (re.compile(r'(--auth-token=)[^\s]+', re.IGNORECASE), r'\1***REDACTED***'),
]


def sanitize_browser_args(args: List[str]) -> List[str]:
    """
    Sanitize browser arguments for safe logging.

    Masks sensitive data like passwords, tokens, and API keys that might
    be present in browser command-line arguments.

    Args:
        args: List of browser arguments

    Returns:
        Sanitized list with sensitive data masked
    """
    sanitized = []
    for arg in args:
        masked_arg = arg
        for pattern, replacement in SENSITIVE_PATTERNS:
            masked_arg = pattern.sub(replacement, masked_arg)
        sanitized.append(masked_arg)
    return sanitized


def sanitize_url_for_logging(url: str, mask_query_params: Optional[List[str]] = None) -> str:
    """
    Sanitize a URL for safe logging.

    Masks sensitive query parameters like tokens, passwords, and API keys.

    Args:
        url: The URL to sanitize
        mask_query_params: List of query parameter names to mask.
                          If None, uses common sensitive params.

    Returns:
        Sanitized URL with sensitive parameters masked
    """
    if not url:
        return url

    default_sensitive_params = [
        "token", "api_key", "apikey", "key", "password", "secret",
        "auth", "authorization", "access_token", "refresh_token"
    ]

    params_to_mask = mask_query_params or default_sensitive_params

    # Simple regex-based masking for query parameters
    sanitized = url
    for param in params_to_mask:
        # Match param=value patterns
        pattern = re.compile(
            rf'([?&])({re.escape(param)})=[^&]+',
            re.IGNORECASE
        )
        sanitized = pattern.sub(rf'\1\2=***REDACTED***', sanitized)

    return sanitized
