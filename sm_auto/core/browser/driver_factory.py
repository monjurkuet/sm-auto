"""
Browser Driver Factory for SM-Auto framework.

Provides a factory for creating nodriver browser instances with
proper configuration and stealth settings.
"""

from pathlib import Path
from typing import Optional, List

import nodriver as uc

from sm_auto.utils.logger import get_logger
from sm_auto.utils.config import BrowserConfig
from sm_auto.utils.security import sanitize_browser_args
from sm_auto.core.exceptions import BrowserLaunchError

logger = get_logger(__name__)


class DriverFactory:
    """
    Factory for creating nodriver browser instances.

    Handles browser initialization with proper configuration,
    letting nodriver manage stealth settings automatically.
    """

    def __init__(self, config: Optional[BrowserConfig] = None):
        """
        Initialize the DriverFactory.

        Args:
            config: Browser configuration. Uses defaults if None.
        """
        self.config = config or BrowserConfig()

    async def create(
        self,
        profile_path: Optional[Path] = None,
        headless: Optional[bool] = None,
        extra_args: Optional[List[str]] = None,
    ):
        """
        Create and return a nodriver browser instance.

        Args:
            profile_path: Path to Chrome profile directory.
                         If None, creates a fresh temporary profile.
            headless: Override headless mode. If None, uses config value.
            extra_args: Additional Chrome arguments. If None, uses config value.

        Returns:
            nodriver Browser instance.

        Raises:
            BrowserLaunchError: If browser fails to launch.
        """
        # Determine settings
        use_headless = headless if headless is not None else self.config.headless
        use_extra_args = extra_args or self.config.extra_args

        # Build browser arguments
        browser_args = [
            "--no-first-run",
            "--no-default-browser-check",
            "--ignore-certificate-errors",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--remote-debugging-port=9222",
        ]

        # Add window size
        browser_args.append(
            f"--window-size={self.config.window_width},{self.config.window_height}"
        )

        # Add user agent if specified
        if self.config.user_agent:
            browser_args.append(f"--user-agent={self.config.user_agent}")

        # Add extra arguments
        browser_args.extend(use_extra_args)

        logger.info("Launching browser with nodriver...")
        logger.debug(f"Profile path: {profile_path or 'temporary'}")
        logger.debug(f"Headless: {use_headless}")
        logger.debug(f"Args: {sanitize_browser_args(browser_args)}")

        try:
            # Launch browser with nodriver
            # NOTE: nodriver handles stealth settings automatically
            # Do NOT add --disable-blink-features or other stealth args
            browser = await uc.start(
                user_data_dir=str(profile_path) if profile_path else None,
                browser_args=browser_args,
                headless=use_headless,
                sandbox=False,
            )

            logger.info("Browser launched successfully")
            return browser

        except Exception as e:
            logger.error(f"Failed to launch browser: {e}")
            raise BrowserLaunchError(f"Failed to launch browser: {e}")

    async def create_with_profile(
        self,
        profile_path: Path,
        headless: Optional[bool] = None,
    ):
        """
        Create a browser instance with a specific profile.

        Convenience wrapper around create() for profile-based launches.

        Args:
            profile_path: Path to Chrome profile directory.
            headless: Override headless mode.

        Returns:
            nodriver Browser instance.
        """
        return await self.create(
            profile_path=profile_path,
            headless=headless,
        )

    async def create_fresh(
        self,
        headless: Optional[bool] = None,
    ):
        """
        Create a browser instance with a fresh temporary profile.

        The temporary profile will be cleaned up when the browser closes.

        Args:
            headless: Override headless mode.

        Returns:
            nodriver Browser instance.
        """
        return await self.create(
            profile_path=None,
            headless=headless,
        )
