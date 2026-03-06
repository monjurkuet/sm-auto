"""
Chrome Profile Manager for SM-Auto framework.

Discovers existing Chrome profiles, allows selection, verifies integrity,
and supports using profiles directly without copying.
"""

import asyncio
import json
import platform
from pathlib import Path
from typing import List, Optional, Dict, Any
from dataclasses import dataclass, field

import aiofiles

from sm_auto.utils.logger import get_logger
from sm_auto.core.exceptions import (
    ProfileNotFoundError,
    ProfileLockedError,
    ChromeInstallationNotFoundError,
)

logger = get_logger(__name__)


@dataclass
class ChromeProfile:
    """Represents a Chrome user profile."""

    name: str
    path: Path
    is_default: bool = False
    last_used: Optional[str] = None
    display_name: Optional[str] = None
    email: Optional[str] = None

    def __str__(self) -> str:
        """String representation for CLI display."""
        display = self.display_name or self.name
        email_str = f" ({self.email})" if self.email else ""
        default_str = " [DEFAULT]" if self.is_default else ""
        return f"{display}{email_str}{default_str}"


@dataclass
class ChromeUserDataDir:
    """Represents a Chrome user data directory with its profiles."""

    path: Path
    is_default: bool = False
    browser_name: str = "Chrome"  # Chrome, Chromium, Chrome Beta, etc.
    profiles: List[ChromeProfile] = field(default_factory=list)


class ProfileManager:
    """
    Manages Chrome user profiles for automation.

    Provides functionality to:
    - Discover existing Chrome profiles on the system
    - Select a profile interactively or by name
    - Verify profile integrity and availability
    - Use profiles directly without copying
    """

    # Common Chrome user data directory locations by OS
    CHROME_USER_DATA_DIRS = {
        "Windows": [
            lambda: Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "User Data",
            lambda: Path.home() / "AppData" / "Local" / "Microsoft" / "Edge" / "User Data",
        ],
        "Darwin": [
            lambda: Path.home() / "Library" / "Application Support" / "Google" / "Chrome",
            lambda: Path.home() / "Library" / "Application Support" / "Microsoft" / "Edge",
            lambda: Path.home() / "Library" / "Application Support" / "Google" / "Chrome Beta",
        ],
        "Linux": [
            lambda: Path.home() / ".config" / "google-chrome",
            lambda: Path.home() / ".config" / "chromium",
            lambda: Path.home() / ".config" / "google-chrome-beta",
            lambda: Path.home() / ".config" / "microsoft-edge",
        ],
    }

    def __init__(self, user_data_dir: Optional[Path] = None):
        """
        Initialize the ProfileManager.

        Args:
            user_data_dir: Custom Chrome User Data directory path.
                          If None, uses auto-detection.
        """
        self.user_data_dir = user_data_dir

    def _get_chrome_user_data_dir(self) -> Path:
        """
        Get the Chrome User Data directory for the current OS.

        Returns:
            Path to Chrome User Data directory.

        Raises:
            ProfileNotFoundError: If Chrome installation is not found.
        """
        # Use custom directory if provided
        if self.user_data_dir:
            if self.user_data_dir.exists():
                return self.user_data_dir
            raise ProfileNotFoundError(
                f"Custom Chrome User Data directory not found: {self.user_data_dir}"
            )

        # Auto-detect based on OS
        system = platform.system()
        
        if system == "Windows":
            base = Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "User Data"
        elif system == "Darwin":
            base = (
                Path.home()
                / "Library"
                / "Application Support"
                / "Google"
                / "Chrome"
            )
        elif system == "Linux":
            # Try common Linux locations
            linux_paths = [
                Path.home() / ".config" / "google-chrome",
                Path.home() / ".config" / "chromium",
                Path.home() / ".config" / "google-chrome-beta",
            ]
            for path in linux_paths:
                if path.exists():
                    return path
            raise ChromeInstallationNotFoundError(
                "Chrome installation not found. Tried: "
                + ", ".join(str(p) for p in linux_paths)
            )
        else:
            raise ChromeInstallationNotFoundError(f"Unsupported operating system: {system}")

        if not base.exists():
            raise ChromeInstallationNotFoundError(
                f"Chrome User Data directory not found at: {base}"
            )

        return base

    @staticmethod
    def detect_all_chrome_dirs() -> List[ChromeUserDataDir]:
        """
        Detect all Chrome user data directories on the system.

        Returns:
            List of ChromeUserDataDir objects with their profiles.
        """
        system = platform.system()
        results: List[ChromeUserDataDir] = []
        seen_paths: set = set()

        # Get potential paths for the current OS
        potential_dirs = ProfileManager.CHROME_USER_DATA_DIRS.get(system, [])

        for dir_func in potential_dirs:
            try:
                user_data_path = dir_func()
                if user_data_path and user_data_path.exists() and user_data_path not in seen_paths:
                    seen_paths.add(user_data_path)

                    # Determine browser name from path
                    path_str = str(user_data_path).lower()
                    if "chromium" in path_str:
                        browser_name = "Chromium"
                    elif "beta" in path_str:
                        browser_name = "Chrome Beta"
                    elif "edge" in path_str:
                        browser_name = "Microsoft Edge"
                    else:
                        browser_name = "Chrome"

                    # Check if this is a default location
                    is_default = ("google-chrome" in path_str and "beta" not in path_str) or (
                        system == "Windows" and "google" in path_str
                    )

                    # Discover profiles in this directory
                    profile_manager = ProfileManager(user_data_dir=user_data_path)
                    profiles = profile_manager.discover_profiles_sync()

                    results.append(ChromeUserDataDir(
                        path=user_data_path,
                        is_default=is_default,
                        browser_name=browser_name,
                        profiles=profiles,
                    ))
            except Exception as e:
                logger.debug(f"Error checking Chrome directory: {e}")
                continue

        return results

    async def discover_profiles(self) -> List[ChromeProfile]:
        """
        Discover all Chrome profiles on the system.

        Scans the Chrome User Data directory and reads profile metadata
        from Preferences files to build a list of available profiles.
        Uses async file I/O for better performance.

        Returns:
            List of discovered ChromeProfile objects.
        """
        return await self._discover_profiles_async()

    def discover_profiles_sync(self) -> List[ChromeProfile]:
        """
        Synchronous version of discover_profiles.
        
        Note: This method runs the async version in an event loop for
        backward compatibility. New code should use discover_profiles().
        """
        try:
            loop = asyncio.get_running_loop()
            # When already in an async context, raise error to indicate misuse
            raise RuntimeError("Already in async context, use await discover_profiles() instead")
        except RuntimeError:
            # No running loop, we can use asyncio.run
            return asyncio.run(self._discover_profiles_async())

    async def _read_preferences_async(self, preferences_path: Path) -> Optional[Dict[str, Any]]:
        """
        Read Chrome preferences file asynchronously.

        Args:
            preferences_path: Path to the Preferences file.

        Returns:
            Dictionary with preferences data, or None if file cannot be read.
        """
        try:
            async with aiofiles.open(preferences_path, "r", encoding="utf-8") as f:
                content = await f.read()
                return json.loads(content)
        except (json.JSONDecodeError, IOError, UnicodeDecodeError) as e:
            logger.debug(f"Could not read preferences from {preferences_path}: {e}")
            return None

    async def _discover_profiles_async(self) -> List[ChromeProfile]:
        """
        Async implementation of profile discovery.

        Returns:
            List of discovered ChromeProfile objects.
        """
        profiles = []
        user_data_dir = self._get_chrome_user_data_dir()

        logger.info(f"Scanning for Chrome profiles in: {user_data_dir}")

        # Look for profile directories (Profile 1, Profile 2, etc.)
        profile_dirs = sorted(user_data_dir.glob("Profile *"))

        # Process profiles concurrently for better performance
        tasks = []
        for profile_dir in profile_dirs:
            if profile_dir.is_dir():
                tasks.append(self._process_profile_async(profile_dir))

        # Gather all results
        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for result in results:
                if isinstance(result, Exception):
                    logger.debug(f"Error processing profile: {result}")
                elif result is not None:
                    profiles.append(result)

        logger.info(f"Discovered {len(profiles)} Chrome profiles")
        return profiles

    async def _process_profile_async(self, profile_dir: Path) -> Optional[ChromeProfile]:
        """
        Process a single profile directory asynchronously.

        Args:
            profile_dir: Path to the profile directory.

        Returns:
            ChromeProfile object or None if profile cannot be processed.
        """
        profile_name = profile_dir.name
        preferences_file = profile_dir / "Preferences"

        profile_info = {
            "name": profile_name,
            "path": profile_dir,
            "is_default": profile_name == "Default",
        }

        # Try to read profile metadata from Preferences asynchronously
        if preferences_file.exists():
            prefs = await self._read_preferences_async(preferences_file)
            if prefs:
                # Extract display name
                profile_info["display_name"] = prefs.get("profile", {}).get(
                    "name", profile_name
                )

                # Extract email if available
                profile_info["email"] = prefs.get("profile", {}).get(
                    "auth_info", {}
                ).get("email", "")

                # Extract last used timestamp
                last_used = prefs.get("profile", {}).get("last_used", "")
                if last_used:
                    profile_info["last_used"] = last_used

        return ChromeProfile(**profile_info)

    def create_profile_from_path(self, profile_path: Path) -> ChromeProfile:
        """
        Create a ChromeProfile from an arbitrary directory path.

        Args:
            profile_path: Path to the profile directory.

        Returns:
            ChromeProfile object.

        Raises:
            ProfileNotFoundError: If path is not a valid profile directory.
        """
        if not profile_path.exists():
            raise ProfileNotFoundError(f"Profile directory not found: {profile_path}")

        if not profile_path.is_dir():
            raise ProfileNotFoundError(f"Path is not a directory: {profile_path}")

        profile_name = profile_path.name
        preferences_file = profile_path / "Preferences"

        profile_info = {
            "name": profile_name,
            "path": profile_path,
            "is_default": profile_name.lower() == "default",
        }

        # Try to read profile metadata from Preferences
        if preferences_file.exists():
            try:
                with open(preferences_file, "r") as f:
                    prefs = json.load(f)

                profile_info["display_name"] = prefs.get("profile", {}).get(
                    "name", profile_name
                )
                profile_info["email"] = prefs.get("profile", {}).get(
                    "auth_info", {}
                ).get("email", "")
                last_used = prefs.get("profile", {}).get("last_used", "")
                if last_used:
                    profile_info["last_used"] = last_used

            except (json.JSONDecodeError, IOError) as e:
                logger.debug(f"Could not read preferences for {profile_name}: {e}")

        return ChromeProfile(**profile_info)

    async def select_profile_interactive(
        self, profiles: Optional[List[ChromeProfile]] = None
    ) -> ChromeProfile:
        """
        Interactively select a profile from the list.

        Args:
            profiles: List of profiles to choose from. If None, discovers profiles.

        Returns:
            Selected ChromeProfile.
        """
        if profiles is None:
            profiles = await self.discover_profiles()

        if not profiles:
            raise ProfileNotFoundError("No Chrome profiles found")

        print("\n=== Available Chrome Profiles ===\n")
        for i, profile in enumerate(profiles, 1):
            print(f"  {i}. {profile}")
        print()

        while True:
            try:
                choice = input("Select profile number (or name): ").strip()

                # Try numeric selection
                if choice.isdigit():
                    idx = int(choice) - 1
                    if 0 <= idx < len(profiles):
                        return profiles[idx]
                    print(f"Invalid selection. Please choose 1-{len(profiles)}.")
                    continue

                # Try name selection
                for profile in profiles:
                    if (
                        choice.lower() == profile.name.lower()
                        or choice.lower() == (profile.display_name or "").lower()
                    ):
                        return profile

                print("Profile not found. Please try again.")

            except KeyboardInterrupt:
                print("\nCancelled.")
                raise

    async def verify_profile(self, profile: ChromeProfile) -> bool:
        """
        Verify that a profile is valid and available for use.

        Checks:
        - Profile directory exists
        - Profile is not locked by running Chrome instance
        - Essential files are accessible

        Args:
            profile: The ChromeProfile to verify.

        Returns:
            True if profile is valid and available.

        Raises:
            ProfileLockedError: If profile is in use by another Chrome instance.
        """
        logger.info(f"Verifying profile: {profile.name}")

        # Check if profile directory exists
        if not profile.path.exists():
            logger.error(f"Profile directory does not exist: {profile.path}")
            return False

        # Check for SingletonLock (indicates Chrome is running with this profile)
        lock_file = profile.path / "SingletonLock"
        if lock_file.exists():
            # On Linux/WSL, check if the lock is held
            try:
                # Try to acquire a non-blocking lock
                import fcntl

                lock_fd = open(lock_file, "r")
                try:
                    fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    fcntl.flock(lock_fd, fcntl.LOCK_UN)
                    lock_fd.close()
                except (IOError, OSError):
                    lock_fd.close()
                    raise ProfileLockedError(
                        f"Profile '{profile.name}' is in use by another Chrome instance. "
                        "Please close Chrome or select a different profile."
                    )
            except ImportError:
                # fcntl not available on Windows, just warn
                logger.warning(
                    f"Profile '{profile.name}' may be in use. "
                    "If Chrome is running with this profile, close it first."
                )

        # Check for essential files
        history_file = profile.path / "History"
        if not history_file.exists():
            logger.warning(f"Profile may be incomplete: no History file found")

        logger.info(f"Profile verified: {profile.name}")
        return True

    async def prepare(
        self,
        profile_name: Optional[str] = None,
        profile_path: Optional[Path] = None,
        interactive: bool = False,
    ) -> Path:
        """
        Prepare a profile for use with nodriver.

        Orchestrates the full discover → select → verify workflow.
        Returns the profile path directly (no copying).

        Args:
            profile_name: Name of profile to use. If None and interactive=False,
                         uses the Default profile. If None and interactive=True,
                         prompts for selection.
            profile_path: Direct path to profile directory. If provided, uses this directly.
            interactive: Whether to prompt for profile selection.

        Returns:
            Path to the profile directory (used directly, not copied).
        """
        # If direct path provided, create profile from it
        if profile_path:
            profile = self.create_profile_from_path(profile_path)
            await self.verify_profile(profile)
            return profile.path

        # Discover available profiles
        profiles = self.discover_profiles()

        if not profiles:
            raise ProfileNotFoundError("No Chrome profiles found")

        # Select profile
        if interactive or profile_name is None:
            if interactive:
                selected = await self.select_profile_interactive(profiles)
            else:
                # Use default profile
                selected = next(
                    (p for p in profiles if p.is_default), profiles[0]
                )
                logger.info(f"Using default profile: {selected.name}")
        else:
            # Find profile by name or display name
            selected = next(
                (p for p in profiles if p.name.lower() == profile_name.lower()
                 or (p.display_name or "").lower() == profile_name.lower()), None
            )
            if selected is None:
                raise ProfileNotFoundError(f"Profile not found: {profile_name}")

        # Verify profile
        await self.verify_profile(selected)

        # Return the profile path directly (no copying)
        return selected.path
