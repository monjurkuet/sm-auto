"""
Session Manager for SM-Auto framework.

Handles browser session lifecycle including launch, cookie persistence,
graceful shutdown, and rate limiting cooldowns.
"""

import asyncio
import json
from pathlib import Path
from typing import Optional, Any, Dict, List
from datetime import datetime, timedelta

import nodriver as uc
from nodriver.core.browser import Browser
from nodriver.core.tab import Tab

from sm_auto.utils.logger import get_logger
from sm_auto.utils.config import get_settings
from sm_auto.core.exceptions import SessionError, SessionExpiredError

logger = get_logger(__name__)


class SessionManager:
    """
    Manages browser session lifecycle.

    Provides functionality for:
    - Launching browser with profile
    - Saving and loading cookies
    - Session health monitoring
    - Cooldown management for rate limiting
    - Graceful shutdown
    """

    def __init__(self):
        """Initialize the SessionManager."""
        self.browser: Optional[Browser] = None
        self.tab: Optional[Tab] = None
        self.profile_path: Optional[Path] = None
        self.session_start: Optional[datetime] = None
        self.last_activity: Optional[datetime] = None
        self._cooldown_until: Optional[datetime] = None

    async def start(
        self,
        profile_path: Optional[Path] = None,
        headless: bool = False,
    ) -> Browser:
        """
        Start a new browser session.

        Args:
            profile_path: Path to Chrome profile directory.
            headless: Whether to run in headless mode.

        Returns:
            nodriver Browser instance.
        """
        from sm_auto.core.browser.driver_factory import DriverFactory

        logger.info("Starting new session...")

        # Store profile path
        self.profile_path = profile_path

        # Create browser using factory
        factory = DriverFactory()
        self.browser = await factory.create(
            profile_path=profile_path,
            headless=headless,
        )

        # Get initial tab
        if self.browser.tabs:
            self.tab = self.browser.tabs[0]
        else:
            self.tab = await self.browser.get("about:blank")

        # Record session start
        self.session_start = datetime.now()
        self.last_activity = datetime.now()

        logger.info(f"Session started with profile: {profile_path or 'temporary'}")
        return self.browser

    async def get_tab(self) -> Tab:
        """
        Get the current tab, creating one if necessary.

        Returns:
            Current Tab instance.
        """
        if self.tab is None:
            if self.browser is None:
                raise SessionError("Browser not started. Call start() first.")
            self.tab = await self.browser.get("about:blank")
        return self.tab

    async def navigate(self, url: str) -> Tab:
        """
        Navigate to a URL.

        Args:
            url: URL to navigate to.

        Returns:
            Tab instance after navigation.
        """
        tab = await self.get_tab()
        await tab.get(url)
        self.last_activity = datetime.now()
        return tab

    async def save_cookies(self, path: Optional[Path] = None) -> None:
        """
        Save cookies from the current session.

        Args:
            path: Path to save cookies. If None, uses profile directory.
        """
        if self.browser is None:
            logger.warning("Cannot save cookies: browser not started")
            return

        save_path = path or (self.profile_path / "cookies.json" if self.profile_path else None)
        if save_path is None:
            logger.warning("No path specified for cookie save")
            return

        try:
            # Get all cookies from browser
            cookies = await self.browser.cookies.get_all()

            # Convert cookies to JSON-serializable format
            serializable_cookies = []
            for cookie in cookies:
                cookie_dict = {
                    "name": cookie.name,
                    "value": cookie.value,
                    "domain": cookie.domain,
                    "path": cookie.path,
                    "secure": cookie.secure,
                    "httpOnly": cookie.http_only,
                    "sameSite": cookie.same_site.value if hasattr(cookie.same_site, 'value') else str(cookie.same_site),
                }
                # Only add expiration if present and not a session cookie
                if cookie.expires and not cookie.session:
                    cookie_dict["expires"] = cookie.expires
                serializable_cookies.append(cookie_dict)

            # Save to file
            with open(save_path, "w") as f:
                json.dump(serializable_cookies, f, indent=2)

            logger.info(f"Saved {len(serializable_cookies)} cookies to: {save_path}")

        except Exception as e:
            logger.error(f"Failed to save cookies: {e}")

    async def load_cookies(self, path: Path) -> int:
        """
        Load cookies from a file.

        Args:
            path: Path to cookies JSON file.

        Returns:
            Number of cookies loaded.
        """
        if self.browser is None:
            logger.warning("Cannot load cookies: browser not started")
            return 0

        if not path.exists():
            logger.debug(f"Cookie file not found: {path}")
            return 0

        try:
            with open(path, "r") as f:
                cookies = json.load(f)

            loaded = 0
            for cookie in cookies:
                try:
                    await self.browser.cookies.set(
                        name=cookie.get("name"),
                        value=cookie.get("value"),
                        domain=cookie.get("domain"),
                        path=cookie.get("path", "/"),
                        secure=cookie.get("secure", False),
                    )
                    loaded += 1
                except Exception as e:
                    logger.debug(f"Failed to set cookie: {e}")

            logger.info(f"Loaded {loaded} cookies from: {path}")
            return loaded

        except Exception as e:
            logger.error(f"Failed to load cookies: {e}")
            return 0

    async def cooldown(self, duration: Optional[float] = None) -> None:
        """
        Pause execution for cooldown period.

        Used when rate limiting or risk signals are detected.

        Args:
            duration: Cooldown duration in seconds. If None, uses random duration.
        """
        if duration is None:
            import random
            duration = random.uniform(30, 120)  # 30s - 2min default

        logger.info(f"Starting cooldown for {duration:.1f} seconds...")
        self._cooldown_until = datetime.now() + timedelta(seconds=duration)
        await asyncio.sleep(duration)
        self._cooldown_until = None
        self.last_activity = datetime.now()

    async def wait_for_cooldown(self) -> None:
        """Wait if currently in cooldown period."""
        if self._cooldown_until and datetime.now() < self._cooldown_until:
            remaining = (self._cooldown_until - datetime.now()).total_seconds()
            logger.info(f"Waiting for cooldown: {remaining:.1f}s remaining")
            await asyncio.sleep(remaining)

    def is_session_valid(self) -> bool:
        """
        Check if the current session is valid.

        Returns:
            True if session is active and healthy.
        """
        if self.browser is None:
            return False
        if self.tab is None:
            return False
        return True

    async def check_session_health(self) -> bool:
        """
        Check the health of the current session.

        Returns:
            True if session is healthy.
        """
        if not self.is_session_valid():
            return False

        try:
            # Try a simple operation to verify session is responsive
            await self.tab.evaluate("1")
            return True
        except Exception as e:
            logger.warning(f"Session health check failed: {e}")
            return False

    async def refresh_session(self) -> bool:
        """
        Attempt to refresh the current session.

        Returns:
            True if refresh was successful.
        """
        if self.browser is None:
            return False

        try:
            # Navigate to home page to refresh
            if self.tab:
                await self.tab.get("about:blank")
            self.last_activity = datetime.now()
            return True
        except Exception as e:
            logger.error(f"Failed to refresh session: {e}")
            return False

    async def stop(self) -> None:
        """
        Stop the browser session gracefully.

        Saves cookies and closes the browser.
        """
        logger.info("Stopping session...")

        if self.browser is not None:
            try:
                # Save cookies before closing
                await self.save_cookies()
            except Exception as e:
                logger.warning(f"Could not save cookies: {e}")

            try:
                # Close browser - nodriver's stop() doesn't return a coroutine in newer versions
                stop_method = getattr(self.browser, 'stop', None)
                if stop_method is not None:
                    result = stop_method()
                    if asyncio.iscoroutine(result):
                        await result
                    logger.info("Browser stopped successfully")
                else:
                    # Fallback: just close tabs and set to None
                    logger.warning("Browser.stop() not available, cleaning up references")
            except Exception as e:
                logger.error(f"Error stopping browser: {e}")
            finally:
                self.browser = None
                self.tab = None
                self.session_start = None
                self.last_activity = None

    async def __aenter__(self):
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.stop()
