"""
Facebook Marketplace Parser.

Parses GraphQL API responses to extract Marketplace listings.
"""

import json
from typing import Optional, Dict, Any, List

from sm_auto.platforms.base.parser_base import JSONParserBase
from sm_auto.platforms.facebook.marketplace.models import MarketplaceListing
from sm_auto.utils.logger import get_logger

logger = get_logger(__name__)


class MarketplaceParser(JSONParserBase[MarketplaceListing]):
    """
    Parser for Facebook Marketplace GraphQL responses.

    Extracts listings from various GraphQL query response formats.
    """

    def parse(self, data: Any) -> Optional[MarketplaceListing]:
        """
        Parse a single listing from data.

        Args:
            data: Raw data to parse.

        Returns:
            MarketplaceListing or None.
        """
        if not isinstance(data, dict):
            return None

        try:
            return MarketplaceListing(
                type=data.get("type", "organic"),
                id=str(data.get("id", "")),
                title=data.get("title", ""),
                price=data.get("price"),
                location=data.get("location"),
                image_url=data.get("image_url"),
                seller_name=data.get("seller_name"),
                seller_id=data.get("seller_id"),
                url=data.get("url", ""),
                extra_data=data.get("extra_data"),
            )
        except Exception as e:
            self._record_error(f"Failed to parse listing: {e}")
            return None

    def parse_many(self, data: Any) -> List[MarketplaceListing]:
        """
        Parse multiple listings from data.

        Args:
            data: Raw data to parse.

        Returns:
            List of MarketplaceListing.
        """
        listings = []

        if isinstance(data, list):
            for item in data:
                listing = self.parse(item)
                if listing:
                    listings.append(listing)
        elif isinstance(data, dict):
            # Try to extract listings from nested structure
            extracted = self.extract_listings(data)
            listings.extend(extracted)

        return listings

    def extract_listings(self, response_data: Dict[str, Any]) -> List[MarketplaceListing]:
        """
        Extract listings from a GraphQL response.

        Args:
            response_data: GraphQL response data.

        Returns:
            List of extracted MarketplaceListing objects.
        """
        listings = []

        try:
            # Handle string input
            if isinstance(response_data, str):
                try:
                    response_data = json.loads(response_data)
                except json.JSONDecodeError:
                    # Try newline-delimited JSON
                    for line in response_data.split("\n"):
                        if line.strip():
                            try:
                                listings.extend(
                                    self.extract_listings(json.loads(line))
                                )
                            except json.JSONDecodeError:
                                continue
                    return listings

            if not isinstance(response_data, dict):
                return listings

            # Debug: print the structure of the response
            print(f"[Parser] Response data keys: {list(response_data.keys())[:10]}")
            
            # Get data root from GraphQL response
            data_root = response_data.get("data", {})
            if not data_root:
                # Try direct access if not wrapped in "data"
                data_root = response_data

            print(f"[Parser] Data root keys: {list(data_root.keys())[:15] if isinstance(data_root, dict) else 'not a dict'}")
            
            # Debug: check if initiate_warm_search is in the response
            if "initiate_warm_search" in data_root:
                print(f"[Parser] Found initiate_warm_search!")
                print(f"[Parser] initiate_warm_search content: {data_root.get('initiate_warm_search')}")
            
            # Debug: check for any marketplace related keys
            if "marketplace_search" in str(data_root).lower():
                print(f"[Parser] Found marketplace_search in data!")
                print(f"[Parser] Data root: {json.dumps(data_root)[:500]}...")

            # Find feed_units in the response
            results = self._find_feed_units(data_root)

            if not results:
                # Debug: search for any key containing 'marketplace'
                logger.debug("[Parser] No feed_units found, searching for marketplace keys...")
                for key in data_root.keys() if isinstance(data_root, dict) else []:
                    if "market" in key.lower():
                        print(f"[Parser] Found key with 'market': {key}")
                return listings

            # Extract edges
            edges = results.get("edges", [])
            if not edges:
                # Try direct nodes
                nodes = results.get("nodes", [])
                for node in nodes:
                    listing = self._parse_node(node)
                    if listing:
                        listings.append(listing)
            else:
                for edge in edges:
                    node = edge.get("node", {})
                    listing = self._parse_node(node)
                    if listing:
                        listings.append(listing)

        except Exception as e:
            logger.error(f"Error extracting listings: {e}")
            self._record_error(f"Extraction error: {e}")

        return listings

    def _find_feed_units(self, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Find feed_units in nested data structure.

        Args:
            data: Data dictionary to search.

        Returns:
            feed_units dictionary or None.
        """
        # Check common entry points
        feed_keys = [
            "marketplace_search",
            "marketplace_feed",
            "marketplace_category_feed",
            "marketplace_comet_browse_feed",
        ]

        for key in feed_keys:
            if key in data:
                result = data[key].get("feed_units")
                if result:
                    return result

        # Check under viewer
        if "viewer" in data:
            result = data["viewer"].get("marketplace_feed_stories")
            if result:
                return result

        # Recursive search
        return self.find_key_recursive(data, "feed_units")

    def _parse_node(self, node: Dict[str, Any]) -> Optional[MarketplaceListing]:
        """
        Parse a node into a MarketplaceListing.

        Args:
            node: Node data from GraphQL response.

        Returns:
            MarketplaceListing or None.
        """
        if not isinstance(node, dict):
            return None

        typename = node.get("__typename", "")

        # Handle organic listings
        if typename == "MarketplaceFeedListingStoryObject":
            return self._parse_organic_listing(node)

        # Handle ads
        elif typename == "MarketplaceFeedAdStory":
            return self._parse_ad_listing(node)

        return None

    def _parse_organic_listing(
        self,
        node: Dict[str, Any]
    ) -> Optional[MarketplaceListing]:
        """
        Parse an organic (non-ad) listing.

        Args:
            node: Node data.

        Returns:
            MarketplaceListing or None.
        """
        listing = node.get("listing", {})
        if not listing:
            return None

        # Extract location
        location_data = listing.get("location", {})
        reverse_geocode = location_data.get("reverse_geocode", {})
        location = (
            reverse_geocode.get("city_page", {}).get("display_name")
            or reverse_geocode.get("city")
        )

        # Extract seller info
        seller = listing.get("marketplace_listing_seller", {})

        # Extract price
        price_data = listing.get("listing_price", {})
        price = price_data.get("formatted_amount") if price_data else None

        # Parse numeric price from amount field
        price_numeric = None
        amount_str = price_data.get("amount") if price_data else None
        if amount_str:
            try:
                price_numeric = float(amount_str)
            except (ValueError, TypeError):
                price_numeric = None

        # Extract converted price from amount_with_offset_in_currency
        price_converted = price_data.get("amount_with_offset_in_currency") if price_data else None

        # Extract image
        image_data = listing.get("primary_listing_photo", {})
        image = image_data.get("image", {}).get("uri") if image_data else None

        # Build listing ID
        listing_id = listing.get("id", "")

        # Extract delivery types (default to empty list if missing)
        delivery_types = listing.get("delivery_types", [])
        if not isinstance(delivery_types, list):
            delivery_types = []

        return MarketplaceListing(
            type="organic",
            id=listing_id,
            title=listing.get("marketplace_listing_title", ""),
            price=price,
            location=location,
            image_url=image,
            seller_name=seller.get("name") if seller else None,
            seller_id=seller.get("id") if seller else None,
            url=f"https://www.facebook.com/marketplace/item/{listing_id}/" if listing_id else "",
            is_sold=listing.get("is_sold"),
            is_pending=listing.get("is_pending"),
            is_hidden=listing.get("is_hidden"),
            category_id=listing.get("marketplace_listing_category_id"),
            price_numeric=price_numeric,
            delivery_types=delivery_types,
            price_converted=price_converted,
        )

    def _parse_ad_listing(
        self,
        node: Dict[str, Any]
    ) -> Optional[MarketplaceListing]:
        """
        Parse an ad/sponsored listing.

        Args:
            node: Node data.

        Returns:
            MarketplaceListing or None.
        """
        story = node.get("story", {})
        if not story:
            return None

        attachments = story.get("attachments", [])
        if not attachments:
            return None

        # For carousel ads, parse first subattachment
        for attachment in attachments:
            subattachments = attachment.get("subattachments", [])
            if subattachments:
                # Return first item in carousel
                sub = subattachments[0]
                return MarketplaceListing(
                    type="ad_carousel",
                    id=node.get("ad_id_string", ""),
                    title=sub.get("title_with_entities", {}).get("text", ""),
                    price=None,
                    location="Sponsored",
                    image_url=(
                        sub.get("media", {}).get("square_media_image", {}).get("uri")
                        or sub.get("media", {}).get("media_image", {}).get("uri")
                    ),
                    seller_name=(
                        node.get("actors", [{}])[0].get("name")
                        if node.get("actors")
                        else None
                    ),
                    url=sub.get("url", ""),
                )

        # For single image ads
        attachment = attachments[0]
        return MarketplaceListing(
            type="ad",
            id=node.get("ad_id_string", ""),
            title=attachment.get("title_with_entities", {}).get("text", ""),
            price=None,
            location="Sponsored",
            image_url=(
                attachment.get("media", {}).get("media_image", {}).get("uri")
                or attachment.get("media", {}).get("square_media_image", {}).get("uri")
            ),
            seller_name=(
                node.get("actors", [{}])[0].get("name")
                if node.get("actors")
                else None
            ),
            url=attachment.get("url", ""),
        )
