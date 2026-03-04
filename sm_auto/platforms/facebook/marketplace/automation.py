"""
Facebook Marketplace Automation.

Provides automation functionality for Facebook Marketplace
including search, scrolling, and data extraction.
"""

import asyncio
from typing import Optional, List, Dict, Any

from sm_auto.platforms.base.platform_base import PlatformBase, PlatformConfig
from sm_auto.platforms.base.automation_base import AutomationBase, AutomationState
from sm_auto.platforms.facebook.marketplace.parser import MarketplaceParser
from sm_auto.platforms.facebook.marketplace.models import (
    MarketplaceListing,
    MarketplaceSearchResult,
    SearchFilters,
)
from sm_auto.core.network.capture_service import CaptureService
from sm_auto.core.network.cdp_interceptor import CDPInterceptor
from sm_auto.core.network.models import NetworkCaptureEvent
from sm_auto.utils.logger import get_logger
from sm_auto.utils.delays import page_delay, task_delay, action_delay, micro_delay

logger = get_logger(__name__)


# Facebook Marketplace selectors
FACEBOOK_SELECTORS = {
    # Search
    "search_input": 'input[aria-label="Search Marketplace"]',
    "search_input_alt": 'input[placeholder="Search Marketplace"]',
    "search_input_type": 'input[type="search"]',
    "search_container": 'div[aria-label="Search Marketplace"]',
    "search_button": 'button[aria-label="Search"]',

    # Marketplace feed
    "feed_container": '[data-pagelet="MainFeed"]',
    "listing_card": '[data-testid="marketplace-feed-item"]',
    "listing_image": '[data-testid="feed-item-image"]',
    "listing_title": '[data-testid="feed-item-title"]',
    "listing_price": '[data-testid="feed-item-price"]',

    # Navigation
    "marketplace_link": '[data-link-id="tab_marketplace"]',
    "next_page": '[aria-label="Next Page"]',

    # Popups/Dialogs
    "cookie_dialog": '[role="alertdialog"]',
    "login_dialog": '[data-testid="login_dialog"]',
}

# Facebook API patterns
FACEBOOK_API_PATTERNS = {
    "graphql": "graphql",
    "marketplace_search": "CometMarketplaceSearch",
    "marketplace_feed": "MarketplaceFeed",
}


class FacebookMarketplaceConfig(PlatformConfig):
    """Configuration for Facebook Marketplace."""

    def __init__(self):
        super().__init__(
            name="facebook_marketplace",
            base_url="https://www.facebook.com/marketplace/",
            login_url="https://www.facebook.com/login/",
            selectors=FACEBOOK_SELECTORS,
            api_patterns=FACEBOOK_API_PATTERNS,
        )


class FacebookMarketplaceAutomation(AutomationBase):
    """
    Automation class for Facebook Marketplace.

    Provides methods for:
    - Searching Marketplace
    - Scrolling through listings
    - Extracting listing data via network interception
    """

    def __init__(
        self,
        platform: PlatformBase,
        capture_service: Optional[CaptureService] = None,
        filters: Optional[SearchFilters] = None,
    ):
        """
        Initialize the automation.

        Args:
            platform: PlatformBase instance.
            capture_service: Optional CaptureService for network interception.
            filters: Optional SearchFilters to apply to results.
        """
        super().__init__(platform)
        self.capture_service = capture_service
        self.parser = MarketplaceParser()
        self._listings: List[MarketplaceListing] = []
        self._capture_task: Optional[asyncio.Task] = None
        self.filters = filters or SearchFilters()

    async def search(
        self,
        query: str,
        max_scroll_count: int = 10,
        scroll_delay: float = 4.0,
        filters: Optional[SearchFilters] = None,
    ) -> MarketplaceSearchResult:
        """
        Search Facebook Marketplace for a query.

        Args:
            query: Search query string.
            max_scroll_count: Maximum number of scroll iterations.
            scroll_delay: Delay between scrolls in seconds.
            filters: Optional SearchFilters to apply to results.

        Returns:
            MarketplaceSearchResult with found listings.
        """
        logger.info(f"Searching Marketplace for: {query}")

        self.state = AutomationState.TASK_RUNNING

        # Use provided filters or fall back to instance filters
        self.filters = filters or self.filters
        if filters:
            logger.info(f"Applying filters: location={filters.location}, "
                       f"price_range={filters.min_price}-{filters.max_price}")

        # Clear previous listings for new search
        self._listings.clear()
        logger.debug(f"Cleared previous listings. Current count: 0")

        try:
            # Start network capture BEFORE search to capture search results
            await self.start_capture()
            logger.info("Network capture started")
            
            # Navigate to Marketplace
            await self.platform.navigate_to_home()
            await page_delay()

            logger.info(f"Current URL after navigate_to_home: {self.tab.url}")

            # Find and use search input
            search_input = await self._find_search_input()
            if search_input is None:
                logger.error("Search input not found")
                # Try to get page content for debugging
                content = await self.tab.get_content()
                logger.error(f"Page content length: {len(content)}")
                return MarketplaceSearchResult(query=query, listings=[])
            
            logger.info(f"Found search input element: {search_input}")

            # Type search query
            await self.type_into(element=search_input, text=query)
            await action_delay()
            
            # Wait for suggestions to appear
            await asyncio.sleep(1)
            
            # Dismiss suggestions dropdown by pressing Escape, then press Enter to search
            logger.info("Dismissing suggestions dropdown and submitting search...")
            await search_input.send_keys("\u001b")  # Escape key
            await asyncio.sleep(0.3)
            
            # Press Enter using JavaScript to trigger proper key event
            logger.info("Submitting search with Enter key...")
            await self.tab.evaluate(
                """
                (function() {
                    var input = document.querySelector('input[aria-label="Search Marketplace"]');
                    if (input) {
                        var event = new KeyboardEvent('keydown', {
                            key: 'Enter',
                            code: 'Enter',
                            keyCode: 13,
                            which: 13,
                            bubbles: true,
                            cancelable: true
                        });
                        input.dispatchEvent(event);
                        return true;
                    }
                    return false;
                })();
                """
            )
            await asyncio.sleep(0.5)
            
            # Check if URL changed (search was submitted)
            current_url = self.tab.url
            logger.info(f"URL after Enter: {current_url}")
            
            # If still on marketplace home, try alternative method - click on search results
            if "search" not in current_url.lower() or "query=" not in current_url.lower():
                logger.info("Enter didn't navigate to search results, trying alternative...")
                
                # Wait a bit more for the search to trigger
                await asyncio.sleep(2)
                current_url = self.tab.url
                
                # Try clicking on the first search suggestion if visible
                try:
                    suggestion = await self.find('[role="option"]', timeout=2.0, raise_on_not_found=False)
                    if suggestion:
                        await suggestion.click()
                        logger.info("Clicked first search suggestion")
                        await asyncio.sleep(1)
                except Exception as e:
                    logger.debug(f"No suggestion to click: {e}")
            
            # Wait for URL to change to include search query
            logger.info("Waiting for search URL to update...")
            for _ in range(10):
                await asyncio.sleep(1)
                current_url = self.tab.url
                if "search" in current_url.lower() and "query=" in current_url.lower():
                    logger.info(f"Search URL confirmed: {current_url}")
                    break
            else:
                logger.info(f"URL after waiting: {self.tab.url}")
            
            logger.info(f"URL after search attempt: {self.tab.url}")
            
            # Wait longer for search results to load via API
            logger.info("Waiting for search results to load...")
            await asyncio.sleep(5)  # Wait 5 seconds for API calls
            await page_delay()
            
            logger.info(f"URL after search: {self.tab.url}")

            # Scroll to load more results
            await self._scroll_and_capture(
                max_scroll_count=max_scroll_count,
                scroll_delay=scroll_delay,
            )

            # Build result
            result = MarketplaceSearchResult(
                query=query,
                listings=self._listings.copy(),
                has_more=len(self._listings) > 0,
            )

            logger.info(f"Search complete. Found {len(result.listings)} listings.")
            
            # Stop network capture
            await self.stop_capture()
            
            return result

        except Exception as e:
            logger.exception(f"Search failed: {e}")
            self.record_error(e)
            return MarketplaceSearchResult(query=query, listings=[])

        finally:
            self.state = AutomationState.AT_HOME

    async def _find_search_input(self):
        """
        Find the search input element.

        Returns:
            Search input element or None.
        """
        selectors = [
            self.platform.get_selector("search_input"),
            self.platform.get_selector("search_input_alt"),
            self.platform.get_selector("search_input_type"),
        ]

        for selector in selectors:
            if not selector:
                continue
            try:
                element = await self.find(selector, timeout=3.0, raise_on_not_found=False)
                if element:
                    logger.debug(f"Found search input with selector: {selector}")
                    return element
            except Exception as e:
                logger.debug(f"Error with selector {selector}: {e}")
                continue

        # Fallback to text search
        try:
            # Try to find input elements by placeholder
            inputs = await self.tab.select_all("input[placeholder*='Search']")
            if inputs:
                logger.debug(f"Found {len(inputs)} inputs with 'Search' placeholder")
                return inputs[0]
            
            # Try generic search
            element = await self.tab.find("Search Marketplace", best_match=True)
            if element:
                logger.debug("Found search input with text search")
                return element
        except Exception as e:
            logger.debug(f"Fallback search failed: {e}")

        return None

    async def _scroll_and_capture(
        self,
        max_scroll_count: int = 10,
        scroll_delay: float = 4.0,
    ) -> None:
        """
        Scroll through listings and capture data.

        Args:
            max_scroll_count: Maximum number of scrolls.
            scroll_delay: Delay between scrolls.
        """
        logger.info(f"Scrolling to load more listings (max: {max_scroll_count})")

        for i in range(max_scroll_count):
            # Check for challenge
            if await self.detect_challenge():
                logger.warning("Challenge detected during scroll")
                resolved = await self.handle_challenge()
                if not resolved:
                    break

            # Scroll
            await self.scroll(pixels=2000, scroll_chunks=5, with_reading_pauses=True)

            # Wait for content to load
            await asyncio.sleep(scroll_delay)

            # Random think pause
            if i % 3 == 0:
                await self.think_pause()

        logger.info(f"Scroll complete. Captured {len(self._listings)} listings.")

    async def _process_capture_event(self, event: NetworkCaptureEvent) -> None:
        """
        Process a captured network event.

        Args:
            event: Captured network event.
        """
        if event.event_type != "response" or not event.body:
            return

        # Check if this is a GraphQL response
        if "graphql" not in event.url.lower():
            return

        print(f"[Parser] Processing GraphQL response, body length: {len(event.body)}")  # Debug

        try:
            # Parse listings from response
            listings = self.parser.extract_listings(event.body)
            print(f"[Parser] Extracted {len(listings)} listings from response")  # Debug
            if listings:
                print(f"[Parser] First listing: {listings[0]}")  # Debug
                # Apply filters to listings
                if self.filters and (self.filters.location or self.filters.min_price or self.filters.max_price):
                    filtered_listings = [l for l in listings if self.filters.matches(l)]
                    logger.debug(f"Filtered {len(listings)} listings to {len(filtered_listings)} matching filters")
                    listings = filtered_listings
                
                # Deduplicate listings before adding
                existing_ids = {listing.id for listing in self._listings}
                new_listings = [l for l in listings if l.id and l.id not in existing_ids]
                
                # Log for debugging GraphQL data capture
                logger.debug(f"Extracted {len(listings)} listings from response, {len(new_listings)} new (deduplicated)")
                
                if new_listings:
                    self._listings.extend(new_listings)
                    logger.info(f"Added {len(new_listings)} new listings. Total: {len(self._listings)}")
                else:
                    logger.debug(f"No new listings found (all duplicates). Current total: {len(self._listings)}")
        except Exception as e:
            logger.debug(f"Error parsing capture event: {e}")

    async def start_capture(self) -> None:
        """Start network capture for listing extraction."""
        if self.capture_service is None:
            logger.warning("No capture service available")
            return

        # Register parser callback
        self.capture_service.register_parser(
            "graphql",
            self._process_capture_event,
        )

        logger.info("Started network capture for Marketplace")

    async def stop_capture(self) -> None:
        """Stop network capture."""
        if self.capture_service is None:
            return

        self.capture_service.unregister_parser(
            "graphql",
            self._process_capture_event,
        )

        logger.info("Stopped network capture for Marketplace")

    def get_listings(self) -> List[MarketplaceListing]:
        """
        Get captured listings.

        Returns:
            List of captured MarketplaceListing.
        """
        return self._listings.copy()

    def clear_listings(self) -> None:
        """Clear captured listings."""
        self._listings.clear()

    async def go_to_marketplace(self) -> None:
        """Navigate to Facebook Marketplace home."""
        logger.info("Navigating to Marketplace...")
        await self.platform.navigate_to_home()
        await page_delay()
        self.state = AutomationState.AT_HOME


class FacebookMarketplacePlatform(PlatformBase):
    """
    Facebook Marketplace platform implementation.

    Combines platform configuration with automation capabilities.
    """

    def __init__(self, session_manager):
        """
        Initialize the platform.

        Args:
            session_manager: SessionManager instance.
        """
        config = FacebookMarketplaceConfig()
        super().__init__(session_manager, config)

        self.capture_service: Optional[CaptureService] = None
        self.interceptor: Optional[CDPInterceptor] = None
        self._automation: Optional[FacebookMarketplaceAutomation] = None

    async def initialize(self) -> None:
        """Initialize the platform."""
        logger.info("Initializing Facebook Marketplace platform...")

        # Navigate to home
        await self.navigate_to_home()

        self._initialized = True
        logger.info("Facebook Marketplace platform initialized")

    async def is_logged_in(self) -> bool:
        """Check if user is logged in."""
        if self.tab is None:
            return False

        try:
            # Check for logged-in indicators
            url = self.tab.url

            # If we're on login page, not logged in
            if "login" in url.lower() or "checkpoint" in url.lower():
                return False

            # Try to find user menu (only visible when logged in)
            user_menu = await self.tab.select(
                '[aria-label="Menu"]',
                timeout=3.0,
            )

            return user_menu is not None

        except Exception:
            return False

    async def navigate_to_home(self):
        """Navigate to Marketplace home."""
        tab = await self.get_tab()
        await tab.get("https://www.facebook.com/marketplace/")
        await page_delay()
        return tab

    def get_automation(self) -> FacebookMarketplaceAutomation:
        """
        Get the automation instance.

        Returns:
            FacebookMarketplaceAutomation instance.
        """
        if self._automation is None:
            self._automation = FacebookMarketplaceAutomation(
                self,
                self.capture_service,
            )
        return self._automation
