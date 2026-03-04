"""
Platform Base Module for SM-Auto framework.

Defines the base interface for all platform implementations.
"""

from abc import ABC, abstractmethod
from typing import Optional, Dict, Any, List
from pathlib import Path

from nodriver.core.browser import Browser
from nodriver.core.tab import Tab

from sm_auto.core.browser.session_manager import SessionManager
from sm_auto.utils.logger import get_logger

logger = get_logger(__name__)


class PlatformConfig:
    """Configuration for a platform."""

    def __init__(
        self,
        name: str,
        base_url: str,
        login_url: Optional[str] = None,
        selectors: Optional[Dict[str, str]] = None,
        api_patterns: Optional[List[str]] = None,
    ):
        """
        Initialize platform configuration.

        Args:
            name: Platform name.
            base_url: Base URL for the platform.
            login_url: URL for login page. If None, uses base_url.
            selectors: DOM selectors for the platform.
            api_patterns: URL patterns for API interception.
        """
        self.name = name
        self.base_url = base_url
        self.login_url = login_url or base_url
        self.selectors = selectors or {}
        self.api_patterns = api_patterns or []


class PlatformBase(ABC):
    """
    Abstract base class for all platform implementations.

    Provides common functionality and defines the interface
    that all platforms must implement.
    """

    def __init__(
        self,
        session_manager: SessionManager,
        config: Optional[PlatformConfig] = None,
    ):
        """
        Initialize the platform.

        Args:
            session_manager: SessionManager instance for browser control.
            config: Platform configuration.
        """
        self.session_manager = session_manager
        self.config = config
        self._initialized = False

    @property
    def browser(self) -> Optional[Browser]:
        """Get the current browser instance."""
        return self.session_manager.browser

    @property
    def tab(self) -> Optional[Tab]:
        """Get the current tab instance."""
        return self.session_manager.tab

    async def get_tab(self) -> Tab:
        """Get or create the current tab."""
        return await self.session_manager.get_tab()

    @abstractmethod
    async def initialize(self) -> None:
        """
        Initialize the platform.

        Called after the browser is started to set up platform-specific
        functionality like network interception and parsers.
        """
        pass

    @abstractmethod
    async def is_logged_in(self) -> bool:
        """
        Check if the user is logged in.

        Returns:
            True if logged in.
        """
        pass

    @abstractmethod
    async def navigate_to_home(self) -> Tab:
        """
        Navigate to the platform's home page.

        Returns:
            Tab instance after navigation.
        """
        pass

    def get_selector(self, name: str) -> Optional[str]:
        """
        Get a DOM selector by name.

        Args:
            name: Selector name.

        Returns:
            Selector string or None.
        """
        if self.config and name in self.config.selectors:
            return self.config.selectors[name]
        return None

    def get_api_pattern(self, name: str) -> Optional[str]:
        """
        Get an API pattern by name.

        Args:
            name: Pattern name.

        Returns:
            API pattern string or None.
        """
        if self.config and name in self.config.api_patterns:
            return self.config.api_patterns[name]
        return None

    async def __aenter__(self):
        """Async context manager entry."""
        await self.initialize()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        pass
