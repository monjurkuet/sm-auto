"""
Automation Base Module for SM-Auto framework.

Provides state machine functionality and human-like interaction primitives
for platform automation.
"""

import asyncio
from enum import Enum, auto
from typing import Optional, List, Any, TYPE_CHECKING

from nodriver.core.element import Element

from sm_auto.platforms.base.platform_base import PlatformBase
from sm_auto.utils.logger import get_logger
from sm_auto.utils.delays import (
    micro_delay,
    action_delay,
    human_type,
    human_click,
    human_scroll,
    random_think_pause,
)
from sm_auto.core.exceptions import (
    ElementNotFoundError,
    ElementInteractionError,
    ChallengeDetectedError,
)

if TYPE_CHECKING:
    from nodriver.core.tab import Tab

logger = get_logger(__name__)


class AutomationState(Enum):
    """States for the automation state machine."""

    INITIALIZING = auto()
    AT_HOME = auto()
    NAVIGATING = auto()
    POPUP_BLOCKING = auto()
    TASK_RUNNING = auto()
    CHALLENGE_PRESENT = auto()
    COOLDOWN = auto()
    ERROR = auto()
    COMPLETED = auto()


class AutomationBase:
    """
    Base class for platform automation.

    Provides:
    - State machine for handling interruptions
    - Human-like interaction primitives
    - Challenge detection and handling
    - Error recovery mechanisms
    """

    def __init__(self, platform: PlatformBase):
        """
        Initialize the automation.

        Args:
            platform: Platform instance to automate.
        """
        self.platform = platform
        self._state = AutomationState.INITIALIZING
        self._last_error: Optional[Exception] = None
        self._retry_count = 0
        self._max_retries = 3

    @property
    def tab(self) -> Optional["Tab"]:
        """Get the current tab."""
        return self.platform.tab

    @property
    def state(self) -> AutomationState:
        """Get current state."""
        return self._state

    @state.setter
    def state(self, new_state: AutomationState):
        """Set new state."""
        old_state = self._state
        self._state = new_state
        logger.debug(f"State changed: {old_state.name} -> {new_state.name}")

    async def set_state(self, new_state: AutomationState) -> None:
        """
        Set new state with optional handling.

        Args:
            new_state: New state to transition to.
        """
        self.state = new_state

    # === Human-like Interaction Primitives ===

    async def click(
        self,
        element: Optional[Element] = None,
        selector: Optional[str] = None,
        timeout: float = 5.0,
    ) -> None:
        """
        Click an element with human-like timing.

        Args:
            element: Element to click. If None, finds by selector.
            selector: CSS selector to find element.
            timeout: Timeout for finding element.
        """
        if element is None:
            if selector is None:
                raise ElementNotFoundError("No element or selector provided")
            element = await self.find(selector, timeout)

        await human_click(element)
        await action_delay()

    async def type_into(
        self,
        element: Optional[Element] = None,
        selector: Optional[str] = None,
        text: str = "",
        timeout: float = 5.0,
        clear_first: bool = True,
    ) -> None:
        """
        Type text into an element with human-like timing.

        Args:
            element: Element to type into. If None, finds by selector.
            selector: CSS selector to find element.
            text: Text to type.
            timeout: Timeout for finding element.
            clear_first: Whether to clear input before typing.
        """
        if element is None:
            if selector is None:
                raise ElementNotFoundError("No element or selector provided")
            element = await self.find(selector, timeout)

        await human_type(element, text, clear_first=clear_first)
        await action_delay()

    async def find(
        self,
        selector: str,
        timeout: float = 5.0,
        raise_on_not_found: bool = True,
    ) -> Optional[Element]:
        """
        Find an element with retry and timeout.

        Args:
            selector: CSS selector.
            timeout: Timeout in seconds.
            raise_on_not_found: Whether to raise exception if not found.

        Returns:
            Element or None.

        Raises:
            ElementNotFoundError: If element not found and raise_on_not_found is True.
        """
        if self.tab is None:
            raise ElementInteractionError("No tab available")

        try:
            element = await self.tab.select(selector, timeout=timeout)
            if element is None and raise_on_not_found:
                raise ElementNotFoundError(f"Element not found: {selector}")
            return element
        except Exception as e:
            if raise_on_not_found:
                raise ElementNotFoundError(f"Element not found: {selector}") from e
            return None

    async def find_all(
        self,
        selector: str,
        timeout: float = 5.0,
    ) -> List[Element]:
        """
        Find all elements matching selector.

        Args:
            selector: CSS selector.
            timeout: Timeout in seconds.

        Returns:
            List of elements.
        """
        if self.tab is None:
            return []

        try:
            elements = await self.tab.select_all(selector, timeout=timeout)
            return elements or []
        except Exception:
            return []

    async def scroll(
        self,
        pixels: int = 2000,
        scroll_chunks: int = 5,
        with_reading_pauses: bool = True,
    ) -> None:
        """
        Scroll the page with human-like behavior.

        Args:
            pixels: Total pixels to scroll.
            scroll_chunks: Number of chunks to divide scroll into.
            with_reading_pauses: Whether to include reading pauses.
        """
        if self.tab is None:
            return

        await human_scroll(
            self.tab,
            pixels=pixels,
            scroll_chunks=scroll_chunks,
            with_reading_pauses=with_reading_pauses,
        )
        await action_delay()

    async def think_pause(self) -> None:
        """Add a random 'thinking' pause."""
        await random_think_pause()

    # === Challenge Detection and Handling ===

    async def detect_challenge(self) -> bool:
        """
        Detect if a CAPTCHA or security challenge is present.

        Returns:
            True if challenge detected.
        """
        if self.tab is None:
            return False

        try:
            # Check URL for challenge indicators
            url = self.tab.url.lower()
            challenge_urls = [
                "checkpoint",
                "security-check",
                "suspicious",
                "captcha",
                "verify",
                "challenge",
            ]

            if any(signal in url for signal in challenge_urls):
                logger.warning("Challenge detected in URL")
                return True

            # Check page content for challenge indicators
            content = await self.tab.get_content()
            content_lower = content.lower()

            # More specific challenge texts - avoid false positives from navigation
            challenge_texts = [
                "complete the security check",
                "verify you're human",
                "enter the characters you see",
                "please confirm you're human",
                "press and hold",
            ]

            if any(text in content_lower for text in challenge_texts):
                logger.warning("Challenge detected in page content")
                return True

            return False

        except Exception as e:
            logger.debug(f"Error checking for challenge: {e}")
            return False

    async def handle_challenge(self) -> bool:
        """
        Handle a detected challenge.

        Prompts user to solve manually and waits for completion.

        Returns:
            True if challenge was resolved.
        """
        logger.warning("Challenge detected! Please solve it manually.")
        logger.info("Automation paused. Solve the challenge in the browser window.")

        # Poll for challenge resolution
        poll_interval = 5.0  # seconds
        max_wait = 300.0  # 5 minutes

        elapsed = 0.0
        while elapsed < max_wait:
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval

            if not await self.detect_challenge():
                logger.info("Challenge resolved. Resuming automation.")
                return True

            if int(elapsed) % 30 == 0:
                logger.info(f"Still waiting for challenge resolution... ({elapsed:.0f}s)")

        logger.error("Challenge not resolved within timeout")
        return False

    # === Popup Handling ===

    async def detect_popup(self) -> bool:
        """
        Detect if a popup or modal is blocking the page.

        Returns:
            True if popup detected.
        """
        if self.tab is None:
            return False

        # Common popup selectors
        popup_selectors = [
            '[role="dialog"]',
            '.modal',
            '.popup',
            '[data-testid="modal"]',
            'div[aria-modal="true"]',
        ]

        for selector in popup_selectors:
            try:
                element = await self.find(selector, timeout=1.0, raise_on_not_found=False)
                if element:
                    return True
            except Exception:
                continue

        return False

    async def close_popup(self) -> bool:
        """
        Attempt to close a popup.

        Returns:
            True if popup was closed.
        """
        # Common close button selectors
        close_selectors = [
            'button[aria-label="Close"]',
            '[data-testid="modal_close_button"]',
            '.modal-close',
            'button.close',
            '[role="dialog"] button:first-child',
        ]

        for selector in close_selectors:
            try:
                element = await self.find(selector, timeout=1.0, raise_on_not_found=False)
                if element:
                    await self.click(element=element)
                    await micro_delay()
                    return True
            except Exception:
                continue

        return False

    # === Error Handling ===

    def record_error(self, error: Exception) -> None:
        """
        Record an error for retry logic.

        Args:
            error: The exception that occurred.
        """
        self._last_error = error
        self._retry_count += 1
        logger.error(f"Error recorded: {error} (retry {self._retry_count}/{self._max_retries})")

    def should_retry(self) -> bool:
        """
        Check if the operation should be retried.

        Returns:
            True if retries remain.
        """
        return self._retry_count < self._max_retries

    def reset_retry_count(self) -> None:
        """Reset the retry counter."""
        self._retry_count = 0
        self._last_error = None

    # === Navigation Helpers ===

    async def wait_for_url(self, url_pattern: str, timeout: float = 30.0) -> bool:
        """
        Wait for the URL to match a pattern.

        Args:
            url_pattern: URL pattern to wait for.
            timeout: Timeout in seconds.

        Returns:
            True if URL matched.
        """
        start_time = asyncio.get_event_loop().time()

        while True:
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed >= timeout:
                return False

            if self.tab and url_pattern in self.tab.url:
                return True

            await asyncio.sleep(0.5)

    async def wait_for_element(
        self,
        selector: str,
        timeout: float = 30.0,
        visible: bool = True,
    ) -> Optional[Element]:
        """
        Wait for an element to appear.

        Args:
            selector: CSS selector.
            timeout: Timeout in seconds.
            visible: Whether to wait for visible element.

        Returns:
            Element or None.
        """
        start_time = asyncio.get_event_loop().time()

        while True:
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed >= timeout:
                return None

            try:
                element = await self.find(selector, timeout=2.0, raise_on_not_found=False)
                if element:
                    return element
            except Exception:
                pass

            await asyncio.sleep(0.5)

        return None
