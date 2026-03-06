"""
Facebook Page Automation.

Provides automation functionality for Facebook page tracking,
including navigation, data extraction, and metric recording.
"""

import asyncio
import json
import re
from datetime import datetime
from typing import Optional, List, Dict, Any

from sm_auto.platforms.base.platform_base import PlatformBase, PlatformConfig
from sm_auto.platforms.base.automation_base import AutomationBase, AutomationState
from sm_auto.platforms.facebook.page.extractor import FacebookPageExtractor
from sm_auto.platforms.facebook.page.models import (
    PageExtractionResult,
    PageUpdateResult,
    FacebookPage,
    FacebookPageMetric,
)
from sm_auto.platforms.facebook.page.storage import FacebookPageStorage
from sm_auto.core.network.capture_service import CaptureService
from sm_auto.core.network.models import NetworkCaptureEvent
from sm_auto.utils.logger import get_logger
from sm_auto.utils.delays import page_delay, task_delay, action_delay, micro_delay

logger = get_logger(__name__)


# Default selectors for Facebook pages
PAGE_SELECTORS = {
    "page_name": "h1",
    "verified_badge": '[aria-label*="Verified"]',
    "like_button": '[data-testid="like_button"]',
    "follow_button": '[data-testid="follow_button"]',
    "about_tab": 'a[href*="/about"]',
    "photos_tab": 'a[href*="/photos"]',
    "posts_tab": 'a[href*="/posts"]',
}


class FacebookPageConfig(PlatformConfig):
    """Configuration for Facebook Page tracking."""

    def __init__(
        self,
        save_debug_html: bool = False,
        max_scrolls: int = 15,
    ):
        """
        Initialize the config.
        
        Args:
            save_debug_html: Whether to save debug HTML files.
            max_scrolls: Maximum number of scroll iterations for lazy loading.
        """
        super().__init__(
            name="facebook_page",
            base_url="https://www.facebook.com/",
            login_url="https://www.facebook.com/login/",
            selectors=PAGE_SELECTORS,
            api_patterns=[],
        )
        self.save_debug_html = save_debug_html
        self.max_scrolls = max_scrolls


class FacebookPagePlatform(PlatformBase):
    """
    Platform class for Facebook Page tracking.

    Handles browser session and page navigation for page scraping.
    """

    def __init__(
        self,
        session_manager,
        config: Optional[FacebookPageConfig] = None,
    ):
        """
        Initialize the platform.

        Args:
            session_manager: SessionManager instance.
            config: Optional FacebookPageConfig instance.
        """
        self._config = config or FacebookPageConfig()
        super().__init__(session_manager, self._config)
        self.extractor = FacebookPageExtractor(debug_mode=self._config.save_debug_html)

    @property
    def config(self) -> FacebookPageConfig:
        """Get the config."""
        return self._config

    async def initialize(self) -> None:
        """Initialize the platform."""
        self._initialized = True
        logger.info("Facebook Page platform initialized")

    async def initialize(self) -> None:
        """Initialize the platform."""
        self._initialized = True
        logger.info("Facebook Page platform initialized")

    async def is_logged_in(self) -> bool:
        """
        Check if user is logged in.

        Returns:
            True if logged in.
        """
        if not self.tab:
            return False

        # Check URL for login indicator
        url = self.tab.url.lower()
        if "login" in url:
            return False

        # Check for logged-in elements
        try:
            content = await self.tab.get_content()
            # Look for user elements that indicate logged in state
            if 'data-pagelet="RightRail"' in content or 'aria-label="Home"' in content:
                return True
        except Exception as e:
            logger.debug(f"Error checking login status: {e}")

        return True

    async def navigate_to_home(self):
        """
        Navigate to Facebook home.

        Returns:
            Tab instance.
        """
        if not self.tab:
            await self.session_manager.get_tab()

        await self.tab.get(self.config.base_url)
        await page_delay()
        return self.tab

    async def navigate_to_page(self, page_url: str) -> bool:
        """
        Navigate to a specific Facebook page.

        Args:
            page_url: URL of the page to visit.

        Returns:
            True if navigation successful.
        """
        if not self.tab:
            await self.session_manager.get_tab()

        logger.info(f"Navigating to page: {page_url}")
        await self.tab.get(page_url)
        await page_delay()

        # Check if we got redirected to login
        current_url = str(self.tab.url)
        if "login" in current_url.lower():
            logger.warning("Redirected to login page - authentication required")
            return False

        return True

    async def navigate_to_transparency(self, page_url: str) -> bool:
        """
        Navigate to the Page Transparency section.
        
        Reference implementation navigates to: /about_profile_transparency
        
        Args:
            page_url: Base URL of the Facebook page.
            
        Returns:
            True if navigation successful.
        """
        transparency_url = f"{page_url.rstrip('/')}/about_profile_transparency"
        logger.info(f"Navigating to transparency page: {transparency_url}")
        
        if not self.tab:
            await self.session_manager.get_tab()
        
        await self.tab.get(transparency_url)
        await page_delay()
        
        current_url = str(self.tab.url)
        if "login" in current_url.lower():
            logger.warning("Redirected to login page - authentication required")
            return False
            
        return True

    async def navigate_to_details(self, page_url: str) -> bool:
        """
        Navigate to the About Details section.
        
        Reference implementation navigates to: /about_contact_and_basic_info
        
        Args:
            page_url: Base URL of the Facebook page.
            
        Returns:
            True if navigation successful.
        """
        details_url = f"{page_url.rstrip('/')}/about_contact_and_basic_info"
        logger.info(f"Navigating to details page: {details_url}")
        
        if not self.tab:
            await self.session_manager.get_tab()
        
        await self.tab.get(details_url)
        await page_delay()
        
        current_url = str(self.tab.url)
        if "login" in current_url.lower():
            logger.warning("Redirected to login page - authentication required")
            return False
            
        return True

    # === Network Capture Methods (following marketplace pattern) ===

    async def start_capture(self) -> None:
        """
        Start network capture for GraphQL data extraction.
        
        This enables capturing GraphQL responses from Facebook API
        for more reliable data extraction.
        """
        if self.capture_service is None:
            logger.warning("No capture service available - network capture disabled")
            return

        # Register parser callback for GraphQL
        self.capture_service.register_parser(
            "graphql",
            self._process_capture_event,
        )

        logger.info("Started network capture for Facebook Page")

    async def stop_capture(self) -> None:
        """Stop network capture."""
        if self.capture_service is None:
            return

        self.capture_service.unregister_parser(
            "graphql",
            self._process_capture_event,
        )

        logger.info("Stopped network capture for Facebook Page")

    async def _process_capture_event(self, event: NetworkCaptureEvent) -> None:
        """
        Process captured GraphQL response event.
        
        Args:
            event: Network capture event containing response data.
        """
        try:
            # Extract response data
            response_text = ""
            if hasattr(event, 'response'):
                response_text = event.response.get('text', '') if isinstance(event.response, dict) else ''
            elif hasattr(event, 'body'):
                response_text = event.body
                
            if not response_text:
                return
                
            # Parse JSON responses (Facebook sends newline-separated JSON)
            for line in response_text.split('\n'):
                if line.strip():
                    try:
                        data = json.loads(line)
                        self._captured_graphql.append(data)
                    except json.JSONDecodeError:
                        pass
                        
            logger.debug(f"Captured GraphQL response, total: {len(self._captured_graphql)}")
            
        except Exception as e:
            logger.debug(f"Error processing capture event: {e}")

    def get_captured_graphql(self) -> List[Dict[str, Any]]:
        """
        Get captured GraphQL responses.
        
        Returns:
            List of captured GraphQL response dictionaries.
        """
        return self._captured_graphql.copy()

    def clear_captured_graphql(self) -> None:
        """Clear captured GraphQL responses."""
        self._captured_graphql = []


class FacebookPageAutomation(AutomationBase):
    """
    Automation class for Facebook Page tracking.

    Provides methods for:
    - Extracting page data
    - Updating page metrics
    - Managing page tracking database
    """

    def __init__(
        self,
        platform: FacebookPagePlatform,
        storage: Optional[FacebookPageStorage] = None,
        capture_service: Optional[CaptureService] = None,
    ):
        """
        Initialize the automation.

        Args:
            platform: FacebookPagePlatform instance.
            storage: Optional FacebookPageStorage instance.
            capture_service: Optional CaptureService for network interception.
        """
        super().__init__(platform)
        self.page_platform = platform
        self.extractor = platform.extractor
        self.storage = storage
        self.capture_service = capture_service
        self._captured_graphql: List[Dict[str, Any]] = []
        self._current_page_url: Optional[str] = None

    async def extract_page(self, page_url: str) -> PageExtractionResult:
        """
        Extract data from a Facebook page using network interception.

        Args:
            page_url: URL of the page to extract.

        Returns:
            PageExtractionResult with extracted data.
        """
        logger.info(f"Extracting data from: {page_url}")
        self._current_page_url = page_url
        
        # Clear previous GraphQL captures for this extraction
        self.clear_captured_graphql()

        # Start network capture BEFORE navigation to capture initial GraphQL responses
        await self.start_capture()

        # Navigate to page
        success = await self.page_platform.navigate_to_page(page_url)
        if not success:
            await self.stop_capture()
            return PageExtractionResult(
                page_url=page_url,
                extraction_method="failed",
            )

        # Wait for initial page load - Facebook is a complex SPA that needs more time
        logger.info("Waiting for Facebook to fully load...")
        await page_delay()  # Use delay utility instead of asyncio.sleep(8)

        # Wait for network to be idle (Facebook loads data via XHR)
        try:
            # Check if page has finished loading major elements
            await self.tab.wait_for_function(
                """() => {
                    // Check if main content container exists
                    const mountPoint = document.getElementById('mount_0_0');
                    if (!mountPoint) return false;
                    // Check if there's actual content (not just loading spinner)
                    const hasContent = mountPoint.innerHTML.length > 10000;
                    // Check if loading spinner is gone
                    const loadingGone = !mountPoint.innerHTML.includes('aria-valuetext="Loading..."');
                    return hasContent && loadingGone;
                }""",
                timeout=15000
            )
            logger.info("Page content loaded")
        except Exception as e:
            logger.debug(f"Wait for content failed: {e}")
            # Fallback wait
            await action_delay()

        # Scroll to trigger lazy loading of content (configurable from config)
        max_scrolls = self.page_platform.config.max_scrolls
        await self._scroll_page(max_scrolls)

        # Wait more for content to render after scroll
        await action_delay()

        # Get current URL to check for redirects
        current_url = str(self.tab.url)
        logger.info(f"Current URL after navigation: {current_url}")

        # Check if we're on a login page
        if "login" in current_url.lower():
            logger.warning("Redirected to login page - authentication required")
            return PageExtractionResult(
                page_url=page_url,
                extraction_method="login_required",
            )

        # Check for other interstitial pages
        if "/checkpoint/" in current_url.lower() or "security" in current_url.lower():
            logger.warning("Security checkpoint detected")
            return PageExtractionResult(
                page_url=page_url,
                extraction_method="verification_required",
            )

        # Extract from HTML with new hybrid approach
        result = await self._extract_from_html_with_retry(page_url)
        return result

    async def _scroll_page(self, max_scrolls: int = 15) -> None:
        """
        Scroll the page with human-like behavior.
        
        Reference implementation uses configurable max_scrolls parameter.
        
        Args:
            max_scrolls: Maximum number of scroll iterations.
        """
        try:
            if not self.tab:
                return
                
            logger.info(f"Scrolling page {max_scrolls} times for lazy loading...")
            for i in range(max_scrolls):
                await self.tab.evaluate("window.scrollBy(0, document.body.scrollHeight)")
                await action_delay()  # Wait for lazy load
                
                if i % 5 == 0:
                    logger.debug(f"Scroll iteration {i+1}/{max_scrolls}...")
            
            # Scroll back to top
            await self.tab.evaluate("window.scrollTo(0, 0)")
            await micro_delay()
            
        except Exception as e:
            logger.debug(f"Scroll failed: {e}")

    async def _extract_from_html_with_retry(self, page_url: str) -> PageExtractionResult:
        """
        Extract from HTML with retry logic and hybrid extraction.
        
        Args:
            page_url: URL of the page.
            
        Returns:
            PageExtractionResult with extracted data.
        """
        max_retries = 2
        
        # Get config for debug mode
        debug_mode = self.page_platform.config.save_debug_html
        
        for attempt in range(max_retries):
            try:
                # Get the rendered HTML using JavaScript to get the full DOM
                html = await self.tab.evaluate("document.documentElement.outerHTML")
                html_length = len(html)
                logger.debug(f"HTML source length: {html_length}")

                # Check for short HTML (interstitial page)
                if html_length < 50000:
                    logger.warning(f"HTML source is very short ({html_length} chars), might be interstitial")
                    if "login" in html.lower():
                        logger.error("Page is a login page")
                        return PageExtractionResult(
                            page_url=page_url,
                            extraction_method="login_required",
                        )
                    if "checkpoint" in html.lower() or "verify" in html.lower():
                        logger.error("Page requires verification")
                        return PageExtractionResult(
                            page_url=page_url,
                            extraction_method="verification_required",
                        )

                # Save debug HTML only if debug mode is enabled
                if debug_mode:
                    debug_file = f"debug_{page_url.split('/')[-1]}.html"
                    with open(debug_file, 'w', encoding='utf-8') as f:
                        f.write(html)
                    logger.info(f"Saved debug HTML to: {debug_file}")

                # === HYBRID EXTRACTION: GraphQL + ARIA + HTML ===
                
                # 1. First: Extract from HTML (existing method)
                result = self.extractor.extract_from_html(html, page_url)
                
                # 2. Second: Extract metrics from ARIA labels (new method)
                aria_metrics = self.extractor.extract_metrics_from_aria(html)
                
                # 3. Third: Extract from captured GraphQL responses
                graphql_data = self.extractor.extract_from_graphql(
                    self.get_captured_graphql()
                )
                
                # Merge all results with proper priority
                result = self.extractor.merge_extraction_results(
                    result, aria_metrics, graphql_data
                )

                # Always try JavaScript DOM extraction to get likes/followers
                logger.info("Trying JavaScript DOM extraction for likes/followers...")
                js_data = None
                try:
                    # First, let's get some debug info about the page
                    debug_info = await self.tab.evaluate(r"""
                        (function() {
                            return {
                                title: document.title,
                                h1Count: document.querySelectorAll('h1').length,
                                h1Texts: Array.from(document.querySelectorAll('h1')).map(el => el.textContent.trim()).slice(0, 5),
                                bodyTextLength: document.body.innerText.length
                            };
                        })()
                    """)
                    logger.debug(f"Page debug info: title={debug_info.get('title')}, h1Count={debug_info.get('h1Count')}, bodyTextLength={debug_info.get('bodyTextLength')}")
                    
                    # Now try to extract data - improved selectors for current Facebook
                    js_result = await self.tab.evaluate(r"""
                        (function() {
                            var data = { 
                                name: null, 
                                likes: null, 
                                followers: null, 
                                talking_about: null, 
                                checkins: null,
                                profile_url: null, 
                                profile_image: null,
                                cover_image: null,
                                category: null,
                                location: null,
                                phone: null,
                                website: null
                            };
                            
                            // Try various selectors for page name
                            var nameSelectors = [
                                'h1', 
                                '[data-pagelet="PageHeader"] h1',
                                '[data-pagelet="PageCover"] h1',
                                'span[aria-level="1"]',
                                'div[role="banner"] h1',
                                '[data-pagelet="TopRow"] h1',
                                'div[aria-labelledby] h1',
                                'span.x1n2onr6',  // Facebook dynamic class
                                'div[aria-live] h1'
                            ];
                            for (var i = 0; i < nameSelectors.length; i++) {
                                var el = document.querySelector(nameSelectors[i]);
                                if (el && el.textContent.trim()) {
                                    var text = el.textContent.trim();
                                    // Skip generic titles
                                    if (text.length > 2 && !text.includes('Facebook') && !text.includes('Log in')) {
                                        data.name = text;
                                        break;
                                    }
                                }
                            }
                            
                            // Look for metrics in the page - Facebook shows them in specific spans or links
                            // Facebook uses various formats: "1,234 likes" or "1.2K likes"
                            var metricsFound = false;
                            
                            // Method 1: Find links that contain 'followers' or 'likes'
                            var links = document.querySelectorAll('a[role="link"], span[role="link"], a');
                            for (var l = 0; l < links.length; l++) {
                                var text = links[l].textContent || '';
                                // Match patterns like "1,234 likes", "1.2K followers", "14,496 talking about this"
                                if (text.toLowerCase().includes('followers') || text.toLowerCase().includes('people follow')) {
                                    var match = text.match(/([\d,.]+[KMBkmb]?)\s*(followers?|people follow)/i);
                                    if (match && !data.followers) {
                                        data.followers = match[1];
                                        metricsFound = true;
                                    }
                                }
                                if (text.toLowerCase().includes('likes') || text.toLowerCase().includes('people like')) {
                                    var match = text.match(/([\d,.]+[KMBkmb]?)\s*(likes?|people like)/i);
                                    if (match && !data.likes) {
                                        data.likes = match[1];
                                        metricsFound = true;
                                    }
                                }
                                if (text.toLowerCase().includes('talking about')) {
                                    var match = text.match(/([\d,.]+[KMBkmb]?)\s*talking about/i);
                                    if (match && !data.talking_about) {
                                        data.talking_about = match[1];
                                    }
                                }
                                if (text.toLowerCase().includes('were here') || text.toLowerCase().includes('checkins')) {
                                    var match = text.match(/([\d,.]+[KMBkmb]?)\s*(were here|checkins?)/i);
                                    if (match && !data.checkins) {
                                        data.checkins = match[1];
                                    }
                                }
                            }
                            
                            // Method 2: Look in spans with specific patterns
                            if (!data.likes || !data.followers) {
                                var allSpans = document.querySelectorAll('span');
                                for (var s = 0; s < allSpans.length; s++) {
                                    var text = allSpans[s].textContent || '';
                                    // Match: "1,234 likes" or "1.2K followers"
                                    var match = text.match(/^([\d,.]+[KMBkmb]?)\s+(likes?|followers?|talking about|were here)/i);
                                    if (match) {
                                        var num = match[1];
                                        var metric = match[2].toLowerCase();
                                        if ((metric.includes('like')) && !data.likes) {
                                            data.likes = num;
                                        }
                                        if ((metric.includes('follow')) && !data.followers) {
                                            data.followers = num;
                                        }
                                        if (metric.includes('talking') && !data.talking_about) {
                                            data.talking_about = num;
                                        }
                                        if (metric.includes('here') && !data.checkins) {
                                            data.checkins = num;
                                        }
                                    }
                                }
                            }
                            
                            // Method 3: Look for structured data in script tags
                            var scripts = document.querySelectorAll('script[type="application/json"]');
                            for (var sc = 0; sc < scripts.length; sc++) {
                                try {
                                    var jsonContent = scripts[sc].textContent;
                                    if (jsonContent && jsonContent.length > 1000) {
                                        // Look for page metrics in JSON
                                        var likeMatch = jsonContent.match(/"likes":\s*(\d+)/);
                                        if (likeMatch && !data.likes) {
                                            data.likes = parseInt(likeMatch[1]).toLocaleString();
                                        }
                                        var followersMatch = jsonContent.match(/"followers":\s*(\d+)/);
                                        if (followersMatch && !data.followers) {
                                            data.followers = parseInt(followersMatch[1]).toLocaleString();
                                        }
                                        var categoryMatch = jsonContent.match(/"category":"([^"]+)"/);
                                        if (categoryMatch && !data.category) {
                                            data.category = categoryMatch[1];
                                        }
                                        var locationMatch = jsonContent.match(/"city":"([^"]+)"/);
                                        if (locationMatch && !data.location) {
                                            data.location = locationMatch[1];
                                        }
                                    }
                                } catch(e) {}
                            }
                            
                            // Try to get profile image from common selectors
                            var imgSelectors = [
                                'img[aria-label*="profile"]', 
                                '[data-pagelet="PageCover"] img',
                                '[data-pagelet="ProfileAvatar"] img',
                                'img[src*="scontent"]',
                                'image[aria-label*="Profile"]'
                            ];
                            for (var k = 0; k < imgSelectors.length; k++) {
                                var img = document.querySelector(imgSelectors[k]);
                                if (img && img.src && img.src.includes('scontent')) {
                                    data.profile_image = img.src;
                                    break;
                                }
                            }
                            
                            // Try to get cover image
                            var coverSelectors = [
                                '[data-pagelet="PageCover"] image',
                                'image[aria-label*="Cover"]',
                                'img[aria-label*="Cover"]'
                            ];
                            for (var c = 0; c < coverSelectors.length; c++) {
                                var cover = document.querySelector(coverSelectors[c]);
                                if (cover && cover.src && cover.src.includes('scontent')) {
                                    data.cover_image = cover.src;
                                    break;
                                }
                            }
                            
                            // Try getting page URL from canonical link
                            var canonical = document.querySelector('link[rel="canonical"]');
                            if (canonical) {
                                data.profile_url = canonical.href;
                            }
                            
                            return data;
                        })()
                    """)
                    if js_result:
                        if js_result.get('name'):
                            result.page_name = js_result.get('name')
                        if js_result.get('likes'):
                            result.likes = js_result.get('likes')
                            result.likes_numeric = self.extractor.parse_numeric(result.likes)
                        if js_result.get('followers'):
                            result.followers = js_result.get('followers')
                            result.followers_numeric = self.extractor.parse_numeric(result.followers)
                        if js_result.get('talking_about'):
                            result.talking_about = js_result.get('talking_about')
                            result.talking_about_numeric = self.extractor.parse_numeric(result.talking_about)
                        if js_result.get('profile_image'):
                            result.profile_image_url = js_result.get('profile_image')
                        if js_result.get('profile_url'):
                            result.page_url = js_result.get('profile_url')
                        if js_result.get('cover_image'):
                            result.cover_image_url = js_result.get('cover_image')
                        if js_result.get('category') and not result.category:
                            result.category = js_result.get('category')
                        if js_result.get('location') and not result.location:
                            result.location = js_result.get('location')
                        if js_result.get('checkins') and not result.checkins:
                            result.checkins = js_result.get('checkins')
                            result.checkins_numeric = self.extractor.parse_numeric(result.checkins)
                        
                        logger.info(f"Extracted from DOM: name={result.page_name}, likes={result.likes}, followers={result.followers}, talking_about={result.talking_about}, category={result.category}")
                except Exception as js_err:
                    logger.debug(f"JavaScript extraction failed: {js_err}")

                # Fallback: Extract page name from URL if still no data
                if not result.page_name:
                    # Try to extract username from URL
                    import re
                    match = re.search(r'facebook\.com/([^/?]+)', page_url)
                    if match:
                        username = match.group(1)
                        # Clean up username (remove query params, etc.)
                        username = username.split('?')[0].split('&')[0]
                        result.username = username
                        result.page_name = username
                        logger.info(f"Using page name from URL: {result.page_name}")

                # DEBUG: If no data extracted, save HTML for debugging
                if not result.page_name and not result.likes:
                    logger.warning(f"No data extracted (attempt {attempt + 1}/{max_retries})")
                    if debug_mode:
                        debug_file = f"debug_{page_url.split('/')[-1]}_{attempt}.html"
                        with open(debug_file, 'w', encoding='utf-8') as f:
                            f.write(html)
                        logger.info(f"Saved debug HTML to: {debug_file}")
                    
                    # Retry after waiting more
                    if attempt < max_retries - 1:
                        logger.info("Waiting longer and retrying...")
                        await action_delay()  # Use delay utility instead of asyncio.sleep(5)
                        continue

                logger.info(
                    f"Extracted page: {result.page_name}, "
                    f"likes: {result.likes}, "
                    f"talking_about: {result.talking_about}"
                )
                return result

            except Exception as e:
                logger.error(f"Error extracting page data: {e}")
                if attempt < max_retries - 1:
                    await micro_delay()  # Use delay utility instead of asyncio.sleep(3)
                    continue
                return PageExtractionResult(
                    page_url=page_url,
                    extraction_method="error",
                )
        
        # Should not reach here but return what we have
        return PageExtractionResult(
            page_url=page_url,
            extraction_method="failed",
        )

    async def extract_deep_page_data(self, page_url: str) -> PageExtractionResult:
        """
        Extract comprehensive data from multiple page sections.
        
        Reference implementation navigates to:
        1. Main page -> Timeline/Posts
        2. /about_profile_transparency -> Page creation date, history
        3. /about_contact_and_basic_info -> Contact info, category, location
        
        Args:
            page_url: URL of the Facebook page.
            
        Returns:
            PageExtractionResult with comprehensive data.
        """
        logger.info(f"Starting deep page extraction for: {page_url}")
        
        # Clear previous GraphQL captures
        self.page_platform.clear_captured_graphql()
        
        # Step 1: Extract from main page
        logger.info("Step 1/3: Extracting from main page...")
        main_result = await self.extract_page(page_url)
        
        # Step 2: Navigate to transparency page
        logger.info("Step 2/3: Navigating to transparency page...")
        transparency_success = await self.page_platform.navigate_to_transparency(page_url)
        
        if transparency_success:
            transparency_html = await self.tab.evaluate("document.documentElement.outerHTML")
            # Extract creation date from transparency page
            creation_match = re.search(r'Page created\s*[-–]\s*(\w+\s+\d+,\s*\d{4})', transparency_html)
            if creation_match:
                main_result.page_created = creation_match.group(1)
                logger.info(f"Found page creation date: {main_result.page_created}")
        
        # Step 3: Navigate to details page
        logger.info("Step 3/3: Navigating to details page...")
        details_success = await self.page_platform.navigate_to_details(page_url)
        
        if details_success:
            details_html = await self.tab.evaluate("document.documentElement.outerHTML")
            # Extract additional contact info from details page
            details_extractor = FacebookPageExtractor()
            details_result = details_extractor.extract_from_html(details_html, page_url)
            
            # Merge additional data
            if details_result.phone and not main_result.phone:
                main_result.phone = details_result.phone
            if details_result.email and not main_result.email:
                main_result.email = details_result.email
            if details_result.location and not main_result.location:
                main_result.location = details_result.location
            if details_result.website and not main_result.website:
                main_result.website = details_result.website
        
        logger.info(
            f"Deep extraction complete: {main_result.page_name}, "
            f"likes: {main_result.likes}, followers: {main_result.followers}"
        )
        
        return main_result

    async def update_page(self, page_url: str) -> PageUpdateResult:
        """
        Update a page in the database.

        Extracts fresh data and saves to storage.

        Args:
            page_url: URL of the page to update.

        Returns:
            PageUpdateResult with update status.
        """
        logger.info(f"Updating page: {page_url}")

        result = PageUpdateResult(
            page_url=page_url,
            page_id="",
            success=False,
        )

        try:
            # Extract page data
            extraction = await self.extract_page(page_url)

            if not extraction.page_id and not extraction.page_name:
                result.error = "Failed to extract page data"
                logger.error(f"Failed to extract data from {page_url}")
                return result

            # Use extracted page_id, or get from storage
            result.page_id = extraction.page_id
            
            # If no page_id was extracted, try to get from storage
            if not result.page_id:
                existing = await self.storage.get_page_by_url(page_url)
                if existing and existing.get("page_id"):
                    result.page_id = existing.get("page_id")
                    extraction.page_id = result.page_id
                    logger.info(f"Using existing page_id from storage: {result.page_id}")
            
            # Log warning if still no numeric page_id - do NOT use username as fallback
            if not result.page_id:
                logger.warning(f"Could not extract numeric page_id for {page_url} - page will be identified by URL")
                result.page_id = page_url  # Use URL as last resort, not username

            # Prepare page document
            page_doc = {
                "page_id": extraction.page_id,
                "page_url": extraction.page_url,
                "username": extraction.username,
                "page_name": extraction.page_name,
                "description": extraction.description,
                "email": extraction.email,
                "profile_image_url": extraction.profile_image_url,
                "cover_image_url": extraction.cover_image_url,
                "category": extraction.category,
                "location": extraction.location,
                "website": extraction.website,
                "phone": extraction.phone,
                "is_verified": extraction.is_verified,
            }

            # Save to storage
            if self.storage:
                # Upsert page
                await self.storage.upsert_page(page_doc)
                result.page_updated = True

                # Insert metric
                metric_doc = {
                    "page_id": extraction.page_id,
                    "likes": extraction.likes,
                    "likes_numeric": extraction.likes_numeric,
                    "followers": extraction.followers,
                    "followers_numeric": extraction.followers_numeric,
                    "talking_about": extraction.talking_about,
                    "talking_about_numeric": extraction.talking_about_numeric,
                    "checkins": extraction.checkins,
                    "checkins_numeric": extraction.checkins_numeric,
                }
                await self.storage.insert_metric(metric_doc)
                result.metric_inserted = True

            result.success = True
            logger.info(
                f"Updated page {extraction.page_name}: "
                f"likes={extraction.likes}, followers={extraction.followers}"
            )

        except Exception as e:
            logger.exception(f"Error updating page {page_url}: {e}")
            result.error = str(e)

        return result

    async def import_from_csv(self, csv_path: str) -> List[PageUpdateResult]:
        """
        Import pages from a CSV file.

        CSV should contain one URL per line.

        Args:
            csv_path: Path to CSV file.

        Returns:
            List of PageUpdateResult for each import.
        """
        logger.info(f"Importing pages from CSV: {csv_path}")

        results = []

        try:
            with open(csv_path, "r") as f:
                urls = [line.strip() for line in f if line.strip()]

            logger.info(f"Found {len(urls)} URLs in CSV")

            for url in urls:
                # Validate URL
                if not url.startswith("http"):
                    url = f"https://www.facebook.com/{url}"

                result = await self.update_page(url)
                results.append(result)

                # Small delay between pages
                await task_delay()

        except Exception as e:
            logger.error(f"Error importing from CSV: {e}")
            raise

        return results

    async def update_all_pages(self) -> List[PageUpdateResult]:
        """
        Update all pages in the database.

        Returns:
            List of PageUpdateResult for each update.
        """
        if not self.storage:
            raise RuntimeError("Storage not configured")

        logger.info("Updating all tracked pages")

        pages = await self.storage.get_all_pages()
        results = []

        for page in pages:
            page_url = page.get("page_url")
            if page_url:
                result = await self.update_page(page_url)
                results.append(result)
                await task_delay()

        return results

    async def update_stale_pages(self, hours: int = 24) -> List[PageUpdateResult]:
        """
        Update pages not checked in specified hours.

        Args:
            hours: Number of hours to consider stale.

        Returns:
            List of PageUpdateResult for each update.
        """
        if not self.storage:
            raise RuntimeError("Storage not configured")

        logger.info(f"Updating stale pages (not checked in {hours} hours)")

        pages = await self.storage.get_stale_pages(hours=hours)
        results = []

        for page in pages:
            page_url = page.get("page_url")
            if page_url:
                result = await self.update_page(page_url)
                results.append(result)
                await task_delay()

        return results


async def create_page_automation(
    session_manager,
    storage: Optional[FacebookPageStorage] = None,
    capture_service: Optional[CaptureService] = None,
    save_debug_html: bool = False,
    max_scrolls: int = 15,
) -> FacebookPageAutomation:
    """
    Create a FacebookPageAutomation instance.

    Args:
        session_manager: SessionManager instance.
        storage: Optional FacebookPageStorage instance.
        capture_service: Optional CaptureService for network interception.
        save_debug_html: Whether to save debug HTML files.
        max_scrolls: Maximum number of scroll iterations for lazy loading.

    Returns:
        Configured FacebookPageAutomation instance.
    """
    config = FacebookPageConfig(
        save_debug_html=save_debug_html,
        max_scrolls=max_scrolls,
    )
    platform = FacebookPagePlatform(session_manager, config)
    await platform.initialize()
    return FacebookPageAutomation(platform, storage, capture_service)
