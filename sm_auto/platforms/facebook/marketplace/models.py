"""
Facebook Marketplace Data Models.

Pydantic models for representing Marketplace listings, ads,
and related data structures.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


class MarketplaceListing(BaseModel):
    """Represents a Facebook Marketplace listing."""

    type: str = Field(
        default="organic",
        description="Listing type: organic, ad, ad_carousel",
    )
    id: str = Field(..., description="Unique listing ID")
    title: str = Field(..., description="Listing title")
    price: Optional[str] = Field(default=None, description="Formatted price")
    location: Optional[str] = Field(default=None, description="Location/city")
    image_url: Optional[str] = Field(default=None, description="Primary image URL")
    seller_name: Optional[str] = Field(default=None, description="Seller name")
    seller_id: Optional[str] = Field(default=None, description="Seller ID")
    url: str = Field(..., description="Direct URL to listing")
    scraped_at: datetime = Field(
        default_factory=datetime.now,
        description="Timestamp when scraped",
    )
    extra_data: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Additional listing data",
    )
    is_sold: Optional[bool] = Field(
        default=None,
        description="Whether the listing is marked as sold",
    )
    is_pending: Optional[bool] = Field(
        default=None,
        description="Whether the listing is pending sale",
    )
    is_hidden: Optional[bool] = Field(
        default=None,
        description="Whether the listing is hidden",
    )
    category_id: Optional[str] = Field(
        default=None,
        description="Marketplace listing category ID",
    )
    price_numeric: Optional[float] = Field(
        default=None,
        description="Numeric price value parsed from listing",
    )
    delivery_types: List[str] = Field(
        default_factory=list,
        description="Available delivery types for the listing",
    )
    price_converted: Optional[str] = Field(
        default=None,
        description="Converted price with currency offset",
    )

    class Config:
        """Pydantic config."""

        json_schema_extra = {
            "example": {
                "type": "organic",
                "id": "1234567890",
                "title": "iPhone 14 Pro",
                "price": "$899",
                "location": "San Francisco, CA",
                "image_url": "https://scontent.xx.fbcdn.net/v/image.jpg",
                "seller_name": "John Doe",
                "seller_id": "100001234567890",
                "url": "https://www.facebook.com/marketplace/item/1234567890/",
                "scraped_at": "2024-01-01T00:00:00Z",
                "is_sold": False,
                "is_pending": False,
                "is_hidden": False,
                "category_id": "electronic",
                "price_numeric": 899.0,
                "delivery_types": ["LOCAL_PICKUP", "SHIPPING"],
                "price_converted": "$899.00",
            }
        }


class MarketplaceSearchResult(BaseModel):
    """Represents search results from Marketplace."""

    query: str = Field(..., description="Search query")
    listings: List[MarketplaceListing] = Field(
        default_factory=list,
        description="List of listings found",
    )
    total_count: Optional[int] = Field(
        default=None,
        description="Total results if available",
    )
    has_more: bool = Field(
        default=False,
        description="Whether more results are available",
    )
    search_timestamp: datetime = Field(
        default_factory=datetime.now,
        description="When search was performed",
    )


class MarketplaceFeedItem(BaseModel):
    """Represents an item from the Marketplace feed."""

    type: str
    id: str
    title: Optional[str]
    price: Optional[str]
    location: Optional[str]
    image_urls: List[str] = Field(default_factory=list)
    seller_name: Optional[str]
    seller_id: Optional[str]
    url: Optional[str]
    is_sponsored: bool = False
    scraped_at: datetime = Field(default_factory=datetime.now)


class MarketplaceCategory(BaseModel):
    """Represents a Marketplace category."""

    id: str
    name: str
    url: str
    parent_id: Optional[str] = None


class MarketplaceSeller(BaseModel):
    """Represents a Marketplace seller."""

    id: str
    name: str
    profile_url: str
    rating: Optional[float] = None
    review_count: Optional[int] = None
    location: Optional[str] = None
    joined_date: Optional[str] = None
    response_rate: Optional[str] = None
    response_time: Optional[str] = None


class SearchFilters(BaseModel):
    """Filters for Marketplace search."""

    location: Optional[str] = Field(
        default=None,
        description="Location/city to filter results (e.g., 'Dhaka', 'Chittagong')",
    )
    min_price: Optional[float] = Field(
        default=None,
        description="Minimum price (numeric)",
    )
    max_price: Optional[float] = Field(
        default=None,
        description="Maximum price (numeric)",
    )
    condition: Optional[str] = Field(
        default=None,
        description="Item condition (new, like_new, good, fair)",
    )
    category: Optional[str] = Field(
        default=None,
        description="Category filter (electronics, vehicles, etc.)",
    )
    currency: Optional[str] = Field(
        default="BDT",
        description="Currency for price comparison (default: BDT)",
    )

    def matches(self, listing: "MarketplaceListing") -> bool:
        """
        Check if a listing matches all the filters.

        Args:
            listing: The listing to check.

        Returns:
            True if listing matches all filters, False otherwise.
        """
        # Location filter
        if self.location and listing.location:
            if self.location.lower() not in listing.location.lower():
                return False

        # Price range filter
        if self.min_price is not None or self.max_price is not None:
            if listing.price:
                # Extract numeric price from formatted string like "BDT45,500"
                price_numeric = self._extract_price(listing.price)
                if price_numeric is not None:
                    if self.min_price is not None and price_numeric < self.min_price:
                        return False
                    if self.max_price is not None and price_numeric > self.max_price:
                        return False
            else:
                # No price available, can't filter
                return False

        return True

    def _extract_price(self, price_str: str) -> Optional[float]:
        """
        Extract numeric price from formatted string.

        Args:
            price_str: Formatted price like "BDT45,500" or "$899"

        Returns:
            Numeric price or None if extraction fails.
        """
        import re

        # Remove currency symbols and commas
        cleaned = re.sub(r"[A-Z$\s,]", "", price_str)
        try:
            return float(cleaned)
        except ValueError:
            return None
