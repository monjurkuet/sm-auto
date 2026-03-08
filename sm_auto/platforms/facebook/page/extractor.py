"""
Facebook Page Extractor.

Extracts page data from Facebook page HTML source using meta tags.
Uses the exact parsing logic from tests/parse_facebook_html.py
and ARIA-based extraction from reference implementation.
"""

import re
import json
from datetime import datetime
from typing import Optional, Dict, Any, List, List
from urllib.parse import urlparse, parse_qs

from sm_auto.platforms.facebook.page.models import PageExtractionResult
from sm_auto.utils.logger import get_logger

logger = get_logger(__name__)


class FacebookPageExtractor:
    """Extracts data from Facebook page HTML using meta tags and ARIA."""

    # ARIA-based selectors for metric extraction (from reference implementation)
    ARIA_METRIC_SELECTORS = [
        '[role="button"][aria-label]',
        '[role="link"][aria-label]',
        'span[aria-label]',
        'a[aria-label]',
    ]

    # GraphQL field patterns for extraction
    GRAPHQL_PATTERNS = {
        'page_id': [r'"page_id":"(\d+)"', r'"id":"(\d+)"', r'"userID":"(\d+)"'],
        'likes': [r'"like_count":(\d+)', r'"likes":\s*\{[^}]*"count":\s*(\d+)'],
        'followers': [r'"followers_count":(\d+)', r'"followers":\s*\{[^}]*"count":\s*(\d+)'],
        'category': [r'"category_name":"([^"]+)"', r'"category":"([^"]+)"'],
        'location': [r'"city":"([^"]+)"', r'"location":\s*\{[^}]*"city":"([^"]+)"'],
        'is_verified': [r'"is_verified":(true|false)', r'"isVerified":(true|false)'],
    }

    def __init__(self, enable_debug: bool = False):
        """
        Initialize the extractor.
        
        Args:
            enable_debug: If True, enable debug logging.
        """
        global debug_mode
        debug_mode = enable_debug
        self.debug_mode = enable_debug

    def extract_from_html(self, html: str, page_url: str) -> PageExtractionResult:
        """
        Extract page data from HTML source.
        
        Uses the exact parsing logic from tests/parse_facebook_html.py

        Args:
            html: Raw HTML source from the page.
            page_url: URL of the page that was scraped.

        Returns:
            PageExtractionResult with extracted data.
        """
        logger.info(f"Extracting page data from HTML for: {page_url}")

        result = PageExtractionResult(
            page_url=page_url,
            extraction_method="html",
        )

        # Extract username from URL
        parsed = urlparse(page_url)
        path = parsed.path.strip("/")
        if path:
            result.username = path.split("/")[0]

        # Extract from meta tags - og:title
        og_title = re.search(r'<meta property="og:title" content="([^"]+)"', html)
        if og_title:
            result.page_name = og_title.group(1)

        # Extract from meta tags - og:description
        og_desc = re.search(r'<meta property="og:description" content="([^"]+)"', html)
        if og_desc:
            result.description = og_desc.group(1)
            logger.info(f"og:description found: {result.description[:200]}")
            # Extract metrics from description
            desc = result.description
            
            # Likes
            likes_match = re.search(r'([\d,.]+)\s*likes', desc, re.IGNORECASE)
            if likes_match:
                result.likes = likes_match.group(1)
                result.likes_numeric = parse_numeric(likes_match.group(1))
            
            # Followers
            followers_match = re.search(r'([\d,.]+)\s*followers', desc, re.IGNORECASE)
            if followers_match:
                result.followers = followers_match.group(1)
                result.followers_numeric = parse_numeric(followers_match.group(1))
            
            # Talking about
            talking_match = re.search(r'([\d,.]+)\s* talking about', desc, re.IGNORECASE)
            if talking_match:
                result.talking_about = talking_match.group(1)
                result.talking_about_numeric = parse_numeric(talking_match.group(1))

            # Checkins (were here)
            checkins_match = re.search(r'([\d,.]+)\s*were here', desc, re.IGNORECASE)
            if checkins_match:
                result.checkins = checkins_match.group(1)
                result.checkins_numeric = parse_numeric(checkins_match.group(1))

        # Extract from meta tags - og:url
        og_url = re.search(r'<meta property="og:url" content="([^"]+)"', html)
        if og_url:
            result.page_url = og_url.group(1)
            # Re-extract username from canonical URL
            parsed = urlparse(result.page_url)
            path = parsed.path.strip("/")
            if path:
                result.username = path.split("/")[0]

        # Extract from meta tags - og:image
        og_image = re.search(r'<meta property="og:image" content="([^"]+)"', html)
        if og_image:
            result.profile_image_url = og_image.group(1)

        # Extract description meta tag
        meta_desc = re.search(r'<meta name="description" content="([^"]+)"', html)
        if meta_desc and not result.description:
            result.description = meta_desc.group(1)

        # If description was from meta name="description", try to extract metrics again
        if meta_desc and not result.likes:
            desc = meta_desc.group(1)
            
            likes_match = re.search(r'([\d,.]+)\s*likes', desc, re.IGNORECASE)
            if likes_match:
                result.likes = likes_match.group(1)
                result.likes_numeric = parse_numeric(likes_match.group(1))
            
            followers_match = re.search(r'([\d,.]+)\s*followers', desc, re.IGNORECASE)
            if followers_match:
                result.followers = followers_match.group(1)
                result.followers_numeric = parse_numeric(followers_match.group(1))
            
            talking_match = re.search(r'([\d,.]+)\s* talking about', desc, re.IGNORECASE)
            if talking_match:
                result.talking_about = talking_match.group(1)
                result.talking_about_numeric = parse_numeric(talking_match.group(1))
            
            checkins_match = re.search(r'([\d,.]+)\s*were here', desc, re.IGNORECASE)
            if checkins_match:
                result.checkins = checkins_match.group(1)
                result.checkins_numeric = parse_numeric(checkins_match.group(1))

        # Extract Twitter data as fallback
        twitter_title = re.search(r'<meta name="twitter:title" content="([^"]+)"', html)
        if twitter_title and not result.page_name:
            result.page_name = twitter_title.group(1)

        twitter_desc = re.search(r'<meta name="twitter:description" content="([^"]+)"', html)
        if twitter_desc:
            twitter_desc_content = twitter_desc.group(1)
            if not result.description:
                result.description = twitter_desc_content
            
            # Parse metrics from twitter:description - this is crucial!
            # Example: "Livewire, Dhaka. 1,032,867 likes · 14,496 talking about this."
            if not result.likes:
                likes_match = re.search(r'([\d,.]+[KMB]?)\s*likes', twitter_desc_content, re.IGNORECASE)
                if likes_match:
                    result.likes = likes_match.group(1)
                    result.likes_numeric = parse_numeric(likes_match.group(1))
            
            if not result.followers:
                followers_match = re.search(r'([\d,.]+[KMB]?)\s*followers', twitter_desc_content, re.IGNORECASE)
                if followers_match:
                    result.followers = followers_match.group(1)
                    result.followers_numeric = parse_numeric(followers_match.group(1))
            
            if not result.talking_about:
                talking_match = re.search(r'([\d,.]+[KMB]?)\s*talking about', twitter_desc_content, re.IGNORECASE)
                if talking_match:
                    result.talking_about = talking_match.group(1)
                    result.talking_about_numeric = parse_numeric(talking_match.group(1))
            
            if not result.checkins:
                checkins_match = re.search(r'([\d,.]+[KMB]?)\s*were here', twitter_desc_content, re.IGNORECASE)
                if checkins_match:
                    result.checkins = checkins_match.group(1)
                    result.checkins_numeric = parse_numeric(checkins_match.group(1))

        twitter_image = re.search(r'<meta name="twitter:image" content="([^"]+)"', html)
        if twitter_image and not result.profile_image_url:
            result.profile_image_url = twitter_image.group(1)

        # Extract page ID from script tags (JSON data)
        # Try multiple patterns as Facebook changes their HTML structure
        page_id = None

        # Pattern 1: Extract from ios_app_url or android_app_url FIRST (most reliable)
        # e.g., fb://profile/100063979652930
        app_url_match = re.search(r'fb://profile/(\d+)', html)
        if app_url_match:
            page_id = app_url_match.group(1)
            logger.debug(f"Found page_id from app URL: {page_id}")

        # Pattern 2: From delegate_page context - this is the actual page ID
        # e.g., "delegate_page":{"id":"257410340949823"
        if not page_id:
            delegate_match = re.search(r'"delegate_page":\s*\{[^}]*"id":\s*"(\d+)"', html)
            if delegate_match:
                page_id = delegate_match.group(1)
                logger.debug(f"Found page_id from delegate_page: {page_id}")

        # Pattern 3: Direct pageID (older format)
        if not page_id:
            page_id_match = re.search(r'"pageID":"(\d+)"', html)
            if page_id_match:
                page_id = page_id_match.group(1)

        # Pattern 4: id with profile context nearby (fallback)
        if not page_id:
            for m in re.finditer(r'"id":"(\d+)"', html):
                start = m.start()
                context = html[max(0, start-200):m.end()+50]
                if 'delegate_page' in context or 'profile' in context:
                    potential_id = m.group(1)
                    # Only use if it's a valid page ID (15+ digits)
                    if len(potential_id) >= 15:
                        page_id = potential_id
                        break

        # Only set page_id if it's numeric (not username)
        if page_id and page_id.isdigit() and len(page_id) >= 10:
            result.page_id = page_id

        # Extract category from script tags - check both "category" and "category_name"
        category_match = re.search(r'"category_name":"([^"]+)"', html)
        if not category_match:
            category_match = re.search(r'"category":"([^"]+)"', html)
        if category_match:
            result.category = category_match.group(1)

        # Extract verified status
        verified_match = re.search(r'"isVerified":(\w+)', html)
        if verified_match:
            result.is_verified = verified_match.group(1) == "true"

        # Extract followers from profile_social_context in JSON
        # This is in the JSON data: "profile_social_context":{..."text":"1M followers"...}
        if not result.followers:
            # Try multiple patterns to find followers
            followers_patterns = [
                r'"profile_social_context":\s*\{[^}]*"text":\s*"([^"]*followers[^"]*)"',
                r'"text":\s*"([^"]*\d+[KMB]?[^"]*followers[^"]*)"',
                r'followers/">[^"]*"([\d,.]+[KMB]?)\s*followers',
            ]
            for pattern in followers_patterns:
                followers_match = re.search(pattern, html)
                if followers_match:
                    followers_text = followers_match.group(1)
                    # Extract number from text like "1M followers" or "1,234 followers"
                    followers_num_match = re.search(r'([\d,.]+[KMBkmb]?)\s*followers', followers_text, re.IGNORECASE)
                    if followers_num_match:
                        result.followers = followers_num_match.group(1)
                        result.followers_numeric = parse_numeric(followers_num_match.group(1))
                        break

        # Extract likes from profile_social_context if not already extracted
        if not result.likes:
            likes_context_match = re.search(r'"profile_social_context":\s*\{[^}]*"text":\s*"([^"]*likes[^"]*)"', html)
            if likes_context_match:
                likes_text = likes_context_match.group(1)
                likes_num_match = re.search(r'([\d,.]+[KMBkmb]?)\s*likes', likes_text, re.IGNORECASE)
                if likes_num_match:
                    result.likes = likes_num_match.group(1)
                    result.likes_numeric = parse_numeric(likes_num_match.group(1))

        # Extract vanity/username from JSON data if available
        vanity_match = re.search(r'"vanity":"([^"]+)"', html)
        if vanity_match and not result.username:
            result.username = vanity_match.group(1)

        # Extract location from JSON data
        if not result.location:
            location_match = re.search(r'"location":\s*\{[^}]*"city":"([^"]+)"', html)
            if location_match:
                result.location = location_match.group(1)
            else:
                # Try to extract from address in description
                location_pattern = re.search(r',\s*([A-Za-z\s]+)\s*\.\s*\d+[,\s]', result.description or '')
                if location_pattern:
                    result.location = location_pattern.group(1).strip()

        # Extract website from JSON data
        if not result.website:
            website_match = re.search(r'"website":"([^"]+)"', html)
            if website_match:
                result.website = website_match.group(1)
            else:
                # Try to extract from description (often contains URL)
                website_pattern = re.search(r'(https?://[^\s]+|www\.[^\s]+)', result.description or '')
                if website_pattern:
                    result.website = website_pattern.group(1)

        # Extract phone from JSON data - be more specific to avoid garbled numbers
        if not result.phone:
            # Try to find phone in structured JSON data first
            phone_json_match = re.search(r'"phone":\s*"([+\d\s\-\(\)]{8,20})"', html)
            if phone_json_match:
                result.phone = phone_json_match.group(1).strip()
            else:
                # Try to extract from description - universal phone format
                # Works for any country - matches common phone patterns
                phone_desc_patterns = [
                    # International format: +1, +44, +880, etc.
                    r'\+[1-9]\d{6,14}',
                    # Country code with space/dash: +1-555, +44-20, etc.
                    r'\+?\d{1,3}[\s\-]?\d{2,4}[\s\-]?\d{3,4}',
                    # US/UK mobile: 10-12 digits
                    r'\b\d{10,12}\b',
                    # Phone with parens: (555) 123-4567
                    r'\(\d{2,4}\)\s*\d{3,4}[\s\-]?\d{3,4}',
                ]
                for pattern in phone_desc_patterns:
                    phone_match = re.search(pattern, result.description or '')
                    if phone_match:
                        result.phone = phone_match.group(0)
                        break

        # Extract email from JSON data
        if not result.email:
            email_match = re.search(r'"email":"([^"]+)"', html)
            if email_match:
                result.email = email_match.group(1)
            else:
                # Try to extract from description
                email_pattern = re.search(r'([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})', result.description or '')
                if email_pattern:
                    result.email = email_pattern.group(1)

        # Extract cover image from og:image (often the first one is profile, later ones are cover)
        og_images = re.findall(r'<meta property="og:image" content="([^"]+)"', html)
        if og_images:
            # First image is usually profile, second is often cover
            if len(og_images) > 1 and not result.cover_image_url:
                # Look for cover image - usually has "cover" in the URL or is larger
                for img_url in og_images[1:]:
                    if 'cover' in img_url.lower() or 'scontent' in img_url:
                        result.cover_image_url = img_url
                        break
                # If no cover found, use second image as cover
                if not result.cover_image_url:
                    result.cover_image_url = og_images[1]
        
        # Fallback: Extract cover photo from JSON cover_photo structure
        # Example: "cover_photo":{"photo":{"image":{"uri":"https://..."
        if not result.cover_image_url:
            cover_json_match = re.search(r'"cover_photo":\{"photo":\{"image":\{"uri":"([^"]+)"', html)
            if cover_json_match:
                result.cover_image_url = cover_json_match.group(1).replace('\\/', '/')

        # Also try to extract from __extraData in script tags
        extra_data_match = re.search(r'"__extraData":\s*\{[^}]+\}', html)
        if extra_data_match:
            extra_data = extra_data_match.group(0)
            # Try to extract additional info
            if not result.location:
                loc_match = re.search(r'"city":"([^"]+)"', extra_data)
                if loc_match:
                    result.location = loc_match.group(1)

        logger.info(
            f"Extracted page: {result.page_name}, "
            f"likes: {result.likes}, "
            f"followers: {result.followers}, "
            f"talking_about: {result.talking_about}"
        )

        return result

    def parse_numeric(self, value: str) -> Optional[int]:
        """
        Parse a formatted number string (e.g., "54,195", "1.2M", "54K") to integer.

        Args:
            value: Formatted number string.

        Returns:
            Integer value or None if parsing fails.
        """
        if not value:
            return None

        # Clean up the string
        cleaned = value.strip().replace(",", "").upper()
        
        # Handle K, M, B suffixes
        multiplier = 1
        if cleaned.endswith('K'):
            multiplier = 1000
            cleaned = cleaned[:-1]
        elif cleaned.endswith('M'):
            multiplier = 1000000
            cleaned = cleaned[:-1]
        elif cleaned.endswith('B'):
            multiplier = 1000000000
            cleaned = cleaned[:-1]

        try:
            # Handle cases like "1.2" with multiplier
            return int(float(cleaned) * multiplier)
        except (ValueError, TypeError):
            return None


def parse_numeric(value: str) -> Optional[int]:
    """
    Parse a formatted number string (e.g., "54,195", "1.2M", "54K") to integer.

    Args:
        value: Formatted number string.

    Returns:
        Integer value or None if parsing fails.
    """
    if not value:
        return None

    # Clean up the string
    cleaned = value.strip().replace(",", "").upper()
    
    # Handle K, M, B suffixes
    multiplier = 1
    if cleaned.endswith('K'):
        multiplier = 1000
        cleaned = cleaned[:-1]
    elif cleaned.endswith('M'):
        multiplier = 1000000
        cleaned = cleaned[:-1]
    elif cleaned.endswith('B'):
        multiplier = 1000000000
        cleaned = cleaned[:-1]

    try:
        # Handle cases like "1.2" with multiplier
        return int(float(cleaned) * multiplier)
    except (ValueError, TypeError):
        return None


# Global debug flag - can be set by the extractor class
debug_mode = False


def _set_debug_mode(enabled: bool):
    """Set global debug mode."""
    global debug_mode
    debug_mode = enabled


def extract_page_id_from_url(url: str) -> Optional[str]:
    """
    Extract page ID from Facebook URL if possible.

    Args:
        url: Facebook page URL

    Returns:
        Page ID if found, None otherwise.
    """
    # Try to extract from query string
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    if "page_id" in query:
        return query["page_id"][0]

    return None


def normalize_page_url(url: str) -> str:
    """
    Normalize a Facebook page URL to canonical form.

    Args:
        url: Input URL

    Returns:
        Normalized URL
    """
    parsed = urlparse(url)

    # Remove trailing slash
    path = parsed.path.rstrip("/")

    # Remove query string and fragment
    normalized = f"{parsed.scheme}://{parsed.netloc}{path}"

    return normalized


def extract_username_from_url(url: str) -> Optional[str]:
    """
    Extract username from a Facebook page URL.

    Args:
        url: Facebook page URL

    Returns:
        Username if found, None otherwise.
    """
    parsed = urlparse(url)
    path = parsed.path.strip("/")

    if not path:
        return None

    # Handle various URL formats:
    # facebook.com/username -> username
    # facebook.com/username/about -> username
    # facebook.com/pages/category/name -> name
    # facebook.com/pages/name/123456 -> 123456
    # facebook.com/pages/123456 -> 123456
    parts = path.split("/")

    if parts[0] == "pages":
        # For pages URLs
        if parts[-1].isdigit():
            return parts[-1]
        return parts[-1]
    else:
        return parts[0]


def extract_metrics_from_aria(html: str) -> Dict[str, Any]:
        """
        Extract likes, followers, shares from ARIA labels.
        
        This is the "absolute source of truth" for metrics per reference implementation.
        Pattern: aria-label="Like: 41 people" or "7 reactions; see who reacted to this"
        
        Args:
            html: Raw HTML source from the page.
            
        Returns:
            Dictionary with extracted metrics.
        """
        metrics = {
            'likes': None,
            'followers': None,
            'talking_about': None,
            'checkins': None,
        }
        
        try:
            # Pattern 1: aria-label attributes containing metric info
            # Match patterns like: "1,234 likes", "1.2K followers", "14,496 talking about this"
            like_patterns = [
                r'aria-label="([^"]*\d[\d,.]*[KMBkmb]?\s*likes?[^"]*)"',
                r'aria-label="([^"]*\d[\d,.]*[KMBkmb]?\s*people like[^"]*)"',
            ]
            
            follower_patterns = [
                r'aria-label="([^"]*\d[\d,.]*[KMBkmb]?\s*followers?[^"]*)"',
                r'aria-label="([^"]*\d[\d,.]*[KMBkmb]?\s*people follow[^"]*)"',
            ]
            
            talking_patterns = [
                r'aria-label="([^"]*\d[\d,.]*[KMBkmb]?\s*talking about[^"]*)"',
            ]
            
            checkin_patterns = [
                r'aria-label="([^"]*\d[\d,.]*[KMBkmb]?\s*(were here|checkins?)[^"]*)"',
            ]
            
            # Extract likes
            for pattern in like_patterns:
                matches = re.findall(pattern, html, re.IGNORECASE)
                for match in matches:
                    num_match = re.search(r'([\d,.]+[KMBkmb]?)', match)
                    if num_match and not metrics['likes']:
                        metrics['likes'] = num_match.group(1)
                        break
                if metrics['likes']:
                    break
            
            # Extract followers
            for pattern in follower_patterns:
                matches = re.findall(pattern, html, re.IGNORECASE)
                for match in matches:
                    num_match = re.search(r'([\d,.]+[KMBkmb]?)', match)
                    if num_match and not metrics['followers']:
                        metrics['followers'] = num_match.group(1)
                        break
                if metrics['followers']:
                    break
            
            # Extract talking about
            for pattern in talking_patterns:
                matches = re.findall(pattern, html, re.IGNORECASE)
                for match in matches:
                    num_match = re.search(r'([\d,.]+[KMBkmb]?)', match)
                    if num_match and not metrics['talking_about']:
                        metrics['talking_about'] = num_match.group(1)
                        break
                if metrics['talking_about']:
                    break
            
            # Extract checkins
            for pattern in checkin_patterns:
                matches = re.findall(pattern, html, re.IGNORECASE)
                for match in matches:
                    num_match = re.search(r'([\d,.]+[KMBkmb]?)', match)
                    if num_match and not metrics['checkins']:
                        metrics['checkins'] = num_match.group(1)
                        break
                if metrics['checkins']:
                    break
                    
            if debug_mode:
                logger.debug(f"Extracted ARIA metrics: {metrics}")
                    
        except Exception as e:
            logger.debug(f"Error extracting ARIA metrics: {e}")
            
        return metrics

def _extract_contact_from_graphql(obj) -> Dict[str, Any]:
    """
    Recursively search GraphQL response for contact info.
    
    Args:
        obj: GraphQL response object (dict or list)
        
    Returns:
        Dictionary with extracted contact info.
    """
    result = {'emails': set(), 'phones': set(), 'websites': set()}
    
    def search(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                # Look for specific fields
                if k in ['phone', 'mobile_phone']:
                    if v and isinstance(v, str) and len(v) >= 8:
                        result['phones'].add(v)
                elif k == 'email':
                    if v and isinstance(v, str) and '@' in v:
                        # Remove mailto: prefix
                        result['emails'].add(v.replace('mailto:', ''))
                elif k in ['website', 'url']:
                    if v and isinstance(v, str):
                        # Filter out redirect links and media
                        if v.startswith('http') and 'l.php' not in v and 'tenor.co' not in v:
                            result['websites'].add(v)
                search(v)
        elif isinstance(obj, list):
            for item in obj:
                search(item)
    
    search(obj)
    return result


def extract_from_graphql(graphql_responses: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Extract page data from intercepted GraphQL responses.
        
        Facebook GraphQL from /api/graphql/ contains:
        - User preferences (xfb_eb_user_preferences)
        - Logged-in user data (user, viewer)
        - Contact info from profile_tile_sections (CONTACT_INFO)
        - Page metrics (followers, likes) are NOT in GraphQL - they come from HTML/DOM
        
        Args:
            graphql_responses: List of parsed GraphQL response dictionaries.
            
        Returns:
            Dictionary with extracted data.
        """
        data = {
            'page_id': None,
            'page_name': None,
            'category': None,
            'location': None,
            'is_verified': None,
            'likes': None,
            'followers': None,
            'profile_image_url': None,
            'cover_image_url': None,
            'description': None,
            'website': None,
            'phone': None,
            'email': None,
        }
        
        # Collect contact info from ALL GraphQL responses
        all_emails = set()
        all_phones = set()
        all_websites = set()
        
        try:
            for response in graphql_responses:
                # Navigate the GraphQL response structure
                # Facebook GraphQL responses from /api/graphql/ contain various data types:
                # - user preferences (xfb_eb_user_preferences)
                # - logged-in user data (user)
                # - page profile data (in different query responses)
                
                payload = response.get('data', {})
                
                # DEBUG: Log what keys we found in the GraphQL response
                if debug_mode:
                    logger.debug(f"GraphQL payload keys: {list(payload.keys())[:10]}")
                
                # Try different root keys - looking for Page profile data
                node = payload.get('node') or payload.get('page') or payload.get('user')
                
                if not node:
                    # Try to find any object with __typename Page or UserProfile
                    # This is how Facebook typically marks entity types
                    for key, value in payload.items():
                        if isinstance(value, dict):
                            typename = value.get('__typename')
                            if typename in ['Page', 'User', 'UserProfile', 'PageProfile']:
                                node = value
                                if debug_mode:
                                    logger.debug(f"Found {typename} in GraphQL key: {key}")
                                break
                
                # If we found user data (not page data), skip - it's the logged-in user, not the page
                if node:
                    typename = node.get('__typename', '')
                    if typename in ['User', 'UserProfile']:
                        # This is logged-in user data, not page profile data
                        # Skip unless it also has page-related fields
                        if not node.get('followers_count') and not node.get('like_count'):
                            if debug_mode:
                                logger.debug(f"Skipping user data - no page metrics")
                            node = None
                
                if not node:
                    # No valid page node found - continue to next response
                    # This is expected: most GraphQL responses are for user prefs, not page data
                    if debug_mode:
                        logger.debug("No page node found in this GraphQL response")
                    continue
                    
                # Extract page ID
                if not data['page_id'] and node.get('id'):
                    data['page_id'] = str(node.get('id'))
                
                # Extract page name
                if not data['page_name']:
                    data['page_name'] = node.get('name')
                
                # Extract category
                if not data['category']:
                    data['category'] = node.get('category_name') or node.get('category')
                
                # Extract verification status
                if not data['is_verified']:
                    data['is_verified'] = node.get('is_verified') or node.get('isVerified')
                
                # Extract location
                if not data['location']:
                    location = node.get('location') or node.get('single_line_address')
                    if location and isinstance(location, dict):
                        data['location'] = location.get('city') or location.get('address')
                    elif location:
                        data['location'] = str(location)
                
                # Extract metrics - these may be in different locations
                if not data['likes']:
                    data['likes'] = node.get('like_count') or node.get('likes', {}).get('count')
                
                if not data['followers']:
                    data['followers'] = node.get('followers_count') or node.get('followers', {}).get('count')
                
                # Extract profile image
                if not data['profile_image_url']:
                    profile_photo = node.get('profile_photo') or node.get('profilePicture')
                    if profile_photo:
                        data['profile_image_url'] = profile_photo.get('uri') or profile_photo.get('url')
                
                # Extract cover photo
                if not data['cover_image_url']:
                    cover_photo = node.get('cover_photo') or node.get('coverPhoto')
                    if cover_photo:
                        data['cover_image_url'] = cover_photo.get('uri') or cover_photo.get('url')
                
                # Extract contact info
                if not data['website']:
                    data['website'] = node.get('website')
                
                if not data['phone']:
                    data['phone'] = node.get('phone') or node.get('mobile_phone')
                
                if not data['email']:
                    data['email'] = node.get('email')
                
                # Extract description
                if not data['description']:
                    data['description'] = node.get('description') or node.get('about')
            
            if debug_mode:
                logger.debug(f"Extracted GraphQL data: {data}")
                
        except Exception as e:
            logger.debug(f"Error extracting GraphQL data: {e}")
        
        # Extract contact info from ALL GraphQL responses (not just node)
        # This finds email, phone, website from profile_tile_sections
        try:
            for response in graphql_responses:
                payload = response.get('data', {})
                contact = _extract_contact_from_graphql(payload)
                all_emails.update(contact['emails'])
                all_phones.update(contact['phones'])
                all_websites.update(contact['websites'])
            
            # Add extracted contact info to data
            if not data['email'] and all_emails:
                data['email'] = list(all_emails)[0]
            if not data['phone'] and all_phones:
                data['phone'] = list(all_phones)[0]
            if not data['website'] and all_websites:
                data['website'] = list(all_websites)[0]
                
            if debug_mode and (all_emails or all_phones or all_websites):
                logger.debug(f"GraphQL contact info - emails: {all_emails}, phones: {all_phones}, websites: {all_websites}")
                
        except Exception as e:
            logger.debug(f"Error extracting contact from GraphQL: {e}")
            
        return data

def merge_extraction_results(
        html_result: PageExtractionResult,
        aria_metrics: Dict[str, Any],
        graphql_data: Dict[str, Any],
    ) -> PageExtractionResult:
        """
        Merge data from multiple extraction sources with priority.
        
        Priority (highest to lowest):
        1. GraphQL data (most reliable)
        2. ARIA metrics (reliable for counts)
        3. HTML/meta tags (fallback)
        
        Args:
            html_result: Result from HTML extraction.
            aria_metrics: Metrics from ARIA extraction.
            graphql_data: Data from GraphQL responses.
            
        Returns:
            Merged PageExtractionResult.
        """
        # Start with HTML result as base
        result = html_result
        
        # Apply GraphQL data (highest priority)
        if graphql_data.get('page_id') and not result.page_id:
            result.page_id = graphql_data['page_id']
        if graphql_data.get('page_name') and not result.page_name:
            result.page_name = graphql_data['page_name']
        if graphql_data.get('category') and not result.category:
            result.category = graphql_data['category']
        if graphql_data.get('location') and not result.location:
            result.location = graphql_data['location']
        if graphql_data.get('is_verified') is not None and result.is_verified is None:
            result.is_verified = graphql_data['is_verified']
        if graphql_data.get('profile_image_url') and not result.profile_image_url:
            result.profile_image_url = graphql_data['profile_image_url']
        if graphql_data.get('cover_image_url') and not result.cover_image_url:
            result.cover_image_url = graphql_data['cover_image_url']
        if graphql_data.get('description') and not result.description:
            result.description = graphql_data['description']
        if graphql_data.get('website') and not result.website:
            result.website = graphql_data['website']
        if graphql_data.get('phone') and not result.phone:
            result.phone = graphql_data['phone']
        if graphql_data.get('email') and not result.email:
            result.email = graphql_data['email']
            
        # Apply GraphQL numeric metrics
        if graphql_data.get('likes') and not result.likes:
            if isinstance(graphql_data['likes'], int):
                result.likes = f"{graphql_data['likes']:,}"
                result.likes_numeric = graphql_data['likes']
            else:
                result.likes = str(graphql_data['likes'])
                result.likes_numeric = parse_numeric(result.likes)
                
        if graphql_data.get('followers') and not result.followers:
            if isinstance(graphql_data['followers'], int):
                result.followers = f"{graphql_data['followers']:,}"
                result.followers_numeric = graphql_data['followers']
            else:
                result.followers = str(graphql_data['followers'])
                result.followers_numeric = parse_numeric(result.followers)
        
        # Apply ARIA metrics (second priority)
        if aria_metrics.get('likes') and not result.likes:
            result.likes = aria_metrics['likes']
            result.likes_numeric = parse_numeric(result.likes)
            
        if aria_metrics.get('followers') and not result.followers:
            result.followers = aria_metrics['followers']
            result.followers_numeric = parse_numeric(result.followers)
            
        if aria_metrics.get('talking_about') and not result.talking_about:
            result.talking_about = aria_metrics['talking_about']
            result.talking_about_numeric = parse_numeric(result.talking_about)
            
        if aria_metrics.get('checkins') and not result.checkins:
            result.checkins = aria_metrics['checkins']
            result.checkins_numeric = parse_numeric(result.checkins)
        
        # Update extraction method
        if graphql_data.get('page_id'):
            result.extraction_method = 'graphql'
        elif aria_metrics.get('likes') or aria_metrics.get('followers'):
            result.extraction_method = 'aria'
        
        return result


def extract_posts_from_graphql(
    graphql_responses: List[Dict[str, Any]],
    page_id: Optional[str] = None,
    page_url: Optional[str] = None,
) -> 'PostExtractionResult':
    """
    Extract posts from captured GraphQL responses.
    
    Parses the ProfileCometTimelineFeedRefetchQuery response to extract
    all available post data including reactions breakdown, media, etc.
    
    Args:
        graphql_responses: List of captured GraphQL response dictionaries.
        page_id: Optional page ID for filtering.
        page_url: Optional page URL for context.
        
    Returns:
        PostExtractionResult with extracted posts.
    """
    from sm_auto.platforms.facebook.page.models import PostExtractionResult, FacebookPost
    
    posts: List[FacebookPost] = []
    seen_post_ids = set()
    
    try:
        for response in graphql_responses:
            # Look for feed edge in GraphQL response
            data = response.get('data', {})
            if not data:
                continue
            
            # Navigate to timeline_list_feed_units
            node = data.get('node', {})
            if not node:
                continue
            
            timeline_units = node.get('timeline_list_feed_units', {})
            edges = timeline_units.get('edges', [])
            
            for edge in edges:
                node_data = edge.get('node', {})
                if not node_data:
                    continue
                
                try:
                    post = _parse_post_node(node_data, page_id, page_url)
                    if post and post.post_id not in seen_post_ids:
                        seen_post_ids.add(post.post_id)
                        posts.append(post)
                        logger.debug(f"Extracted post: {post.post_id}, text: {post.text[:50] if post.text else 'N/A'}...")
                except Exception as e:
                    logger.warning(f"Error parsing post node: {e}")
                    continue
    
    except Exception as e:
        logger.error(f"Error extracting posts from GraphQL: {e}")
    
    # Sort posts by creation time (newest first)
    posts.sort(key=lambda p: p.created_at_timestamp or 0, reverse=True)
    
    return PostExtractionResult(
        posts=posts,
        posts_count=len(posts),
        page_id=page_id,
        page_url=page_url,
    )


def _parse_post_node(
    node: Dict[str, Any],
    page_id: Optional[str] = None,
    page_url: Optional[str] = None,
) -> Optional[FacebookPost]:
    """Parse a single post node from GraphQL response."""
    from sm_auto.platforms.facebook.page.models import FacebookPost
    from datetime import datetime
    
    # Extract core identifiers
    post_id = node.get('post_id')
    if not post_id:
        # Try to get from tracking or other sources
        tracking = node.get('tracking', '')
        if tracking:
            try:
                tracking_data = json.loads(tracking) if isinstance(tracking, str) else tracking
                post_id = tracking_data.get('top_level_post_id') or tracking_data.get('mf_story_key')
            except:
                pass
    
    if not post_id:
        return None
    
    # Get feedback data
    feedback = node.get('feedback', {})
    feedback_id = feedback.get('id')
    
    # Get owning profile (page info)
    owning_profile = feedback.get('owning_profile', {})
    extracted_page_id = owning_profile.get('id') or page_id
    page_name = owning_profile.get('name')
    
    # Navigate to comet_sections for content
    comet_sections = node.get('comet_sections', {})
    content = comet_sections.get('content', {})
    story = content.get('story', {})
    
    # Extract text content
    message_data = story.get('message', {})
    text = message_data.get('message', {}).get('text') or message_data.get('text')
    is_text_only = story.get('message', {}).get('is_text_only_story', False)
    
    # Extract text preview
    text_preview = None
    if text:
        text_preview = text[:500] if len(text) > 500 else text
    
    # Extract mentions, hashtags, links from message ranges
    mentions = []
    hashtags = []
    external_links = []
    
    message_ranges = message_data.get('message', {}).get('ranges', [])
    for range_item in message_ranges:
        entity = range_item.get('entity', {})
        entity_type = entity.get('__typename', '')
        
        if entity_type == 'User':
            mentions.append({
                'name': entity.get('short_name') or entity.get('name', ''),
                'id': entity.get('id', ''),
                'url': entity.get('url') or entity.get('profile_url', '')
            })
        elif entity_type == 'Hashtag':
            hashtags.append(entity.get('url', ''))
        elif entity_type == 'ExternalUrl':
            external_links.append({
                'url': entity.get('url', ''),
                'display_url': entity.get('external_url', '')
            })
    
    # Extract creation time
    created_at_timestamp = story.get('creation_time')
    created_at = None
    if created_at_timestamp:
        try:
            created_at = datetime.fromtimestamp(created_at_timestamp)
        except:
            pass
    
    # Extract post URL
    post_url = story.get('url')
    
    # Extract engagement metrics from comet_ufi_summary_and_actions_renderer
    reaction_count = None
    reactions = {}
    reactions_like = None
    reactions_love = None
    reactions_haha = None
    reactions_wow = None
    reactions_sad = None
    reactions_angry = None
    reactions_care = None
    
    share_count = None
    comment_count = None
    
    # Find the feedback section in comet_sections
    ufis = comet_sections.get('ufi', {})
    summary_and_actions = ufis.get('comet_ufi_summary_and_actions_renderer', {})
    feedback_data = summary_and_actions.get('feedback', {})
    
    if feedback_data:
        # Reactions
        reaction_count = feedback_data.get('reaction_count', {}).get('count')
        top_reactions = feedback_data.get('top_reactions', {}).get('edges', [])
        
        for reaction_edge in top_reactions:
            reaction_node = reaction_edge.get('node', {})
            localized_name = reaction_node.get('localized_name', '').lower()
            count = reaction_edge.get('reaction_count', 0)
            
            reactions[localized_name] = count
            
            # Map to individual fields
            if localized_name == 'like':
                reactions_like = count
            elif localized_name == 'love':
                reactions_love = count
            elif localized_name == 'haha':
                reactions_haha = count
            elif localized_name == 'wow':
                reactions_wow = count
            elif localized_name == 'sad':
                reactions_sad = count
            elif localized_name == 'angry':
                reactions_angry = count
            elif localized_name == 'care':
                reactions_care = count
        
        # Shares
        share_count = feedback_data.get('share_count', {}).get('count')
        
        # Comments
        comments_renderer = feedback_data.get('comments_count_summary_renderer', {})
        comment_feedback = comments_renderer.get('feedback', {})
        comment_instance = comment_feedback.get('comment_rendering_instance', {})
        comments_data = comment_instance.get('comments', {})
        comment_count = comments_data.get('total_count')
    
    # Extract media/attachments
    media_type = None
    media_ids = []
    media_urls = []
    thumbnail_urls = []
    video_duration_sec = None
    video_height = None
    video_width = None
    is_live = False
    is_reel = False
    is_looping = False
    
    attachments = node.get('attachments', [])
    for attachment in attachments:
        media = attachment.get('media', {})
        media_typename = media.get('__typename', '')
        
        if media_typename == 'Video':
            media_type = 'video'
            media_ids.append(media.get('id', ''))
            
            # Get video URL
            video_url = media.get('url') or media.get('permalink_url')
            if video_url:
                media_urls.append(video_url)
            
            # Check if reel
            if video_url and '/reel/' in video_url:
                is_reel = True
            
            # Video metadata
            video_duration_sec = media.get('length_in_second')
            video_height = media.get('height')
            video_width = media.get('width')
            is_live = media.get('is_live_streaming', False)
            is_looping = media.get('is_looping', False)
            
            # Get thumbnail
            preferred_thumbnail = media.get('preferred_thumbnail', {})
            thumbnail = preferred_thumbnail.get('image', {})
            thumbnail_url = thumbnail.get('uri')
            if thumbnail_url:
                thumbnail_urls.append(thumbnail_url)
            
            # Also get first_frame_thumbnail
            first_frame = media.get('first_frame_thumbnail')
            if first_frame and first_frame not in thumbnail_urls:
                thumbnail_urls.append(first_frame)
                
        elif media_typename == 'Image':
            if not media_type:  # Don't override video
                media_type = 'image'
            media_ids.append(media.get('id', ''))
            
            # Get image URL from preferred_thumbnail
            preferred_thumbnail = media.get('preferred_thumbnail', {})
            thumbnail = preferred_thumbnail.get('image', {})
            image_url = thumbnail.get('uri')
            if image_url:
                media_urls.append(image_url)
                thumbnail_urls.append(image_url)
    
    # Determine post type
    post_type = None
    if is_reel:
        post_type = 'reel'
    elif media_type == 'video':
        post_type = 'video_inline'
    elif media_type == 'image':
        post_type = 'photo'
    elif text and not media_urls:
        post_type = 'text'
    else:
        post_type = 'link'
    
    # Extract cache_id
    cache_id = node.get('cache_id')
    
    # Create the post object
    post = FacebookPost(
        # Core identifiers
        post_id=str(post_id),
        node_id=node.get('id'),
        feedback_id=feedback_id,
        page_id=str(extracted_page_id) if extracted_page_id else '',
        page_name=page_name,
        page_url=page_url,
        
        # URLs
        post_url=post_url,
        
        # Content
        text=text,
        text_preview=text_preview,
        is_text_only=is_text_only,
        
        # Content metadata
        mentions=mentions if mentions else None,
        hashtags=hashtags if hashtags else None,
        external_links=external_links if external_links else None,
        
        # Timestamps
        created_at_timestamp=created_at_timestamp,
        created_at=created_at,
        
        # Reactions
        reaction_count=reaction_count,
        reactions=reactions if reactions else None,
        reactions_like=reactions_like,
        reactions_love=reactions_love,
        reactions_haha=reactions_haha,
        reactions_wow=reactions_wow,
        reactions_sad=reactions_sad,
        reactions_angry=reactions_angry,
        reactions_care=reactions_care,
        
        # Comments and shares
        comment_count=comment_count,
        share_count=share_count,
        
        # Media
        media_type=media_type,
        media_ids=media_ids if media_ids else None,
        media_urls=media_urls if media_urls else None,
        thumbnail_urls=thumbnail_urls if thumbnail_urls else None,
        
        # Video specific
        video_duration_sec=video_duration_sec,
        video_height=video_height,
        video_width=video_width,
        is_live=is_live,
        is_reel=is_reel,
        is_looping=is_looping,
        
        # Post classification
        post_type=post_type,
        
        # Metadata
        cache_id=cache_id,
    )
    
    return post
