"""
Tests for Facebook Marketplace models.

Unit tests for MarketplaceListing model including all new fields
added in Phase 1 of the marketplace data expansion.
"""

import json
from datetime import datetime

import pytest
from pydantic import ValidationError

from sm_auto.platforms.facebook.marketplace.models import (
    MarketplaceListing,
    MarketplaceSearchResult,
    MarketplaceFeedItem,
    MarketplaceCategory,
    MarketplaceSeller,
    SearchFilters,
)


class TestMarketplaceListing:
    """Test cases for MarketplaceListing model."""

    def test_model_instantiation_with_all_new_fields(self):
        """Test that MarketplaceListing can be instantiated with all 7 new fields."""
        listing = MarketplaceListing(
            id="1234567890",
            title="iPhone 14 Pro",
            price="$899",
            location="San Francisco, CA",
            image_url="https://example.com/image.jpg",
            seller_name="John Doe",
            seller_id="100001234567890",
            url="https://www.facebook.com/marketplace/item/1234567890/",
            is_sold=False,
            is_pending=False,
            is_hidden=False,
            category_id="electronics",
            price_numeric=899.0,
            delivery_types=["LOCAL_PICKUP", "SHIPPING"],
            price_converted="$899.00",
        )

        assert listing.id == "1234567890"
        assert listing.title == "iPhone 14 Pro"
        assert listing.price == "$899"
        assert listing.location == "San Francisco, CA"
        assert listing.is_sold is False
        assert listing.is_pending is False
        assert listing.is_hidden is False
        assert listing.category_id == "electronics"
        assert listing.price_numeric == 899.0
        assert listing.delivery_types == ["LOCAL_PICKUP", "SHIPPING"]
        assert listing.price_converted == "$899.00"

    def test_default_values_for_optional_fields(self):
        """Test that optional fields have correct default values."""
        listing = MarketplaceListing(
            id="1234567890",
            title="Test Item",
            url="https://www.facebook.com/marketplace/item/1234567890/",
        )

        # Optional fields should default to None
        assert listing.price is None
        assert listing.location is None
        assert listing.image_url is None
        assert listing.seller_name is None
        assert listing.seller_id is None
        assert listing.is_sold is None
        assert listing.is_pending is None
        assert listing.is_hidden is None
        assert listing.category_id is None
        assert listing.price_numeric is None
        assert listing.price_converted is None

        # delivery_types should default to empty list
        assert listing.delivery_types == []

        # type should default to "organic"
        assert listing.type == "organic"

    def test_json_schema_extra_example(self):
        """Test that json_schema_extra contains valid example data."""
        schema = MarketplaceListing.model_json_schema()
        example = schema.get("example", {})

        # Verify all new fields are in the example
        assert "is_sold" in example
        assert "is_pending" in example
        assert "is_hidden" in example
        assert "category_id" in example
        assert "price_numeric" in example
        assert "delivery_types" in example
        assert "price_converted" in example

        # Verify example values are correct types
        assert isinstance(example["is_sold"], bool)
        assert isinstance(example["is_pending"], bool)
        assert isinstance(example["is_hidden"], bool)
        assert isinstance(example["category_id"], str)
        assert isinstance(example["price_numeric"], float)
        assert isinstance(example["delivery_types"], list)
        assert isinstance(example["price_converted"], str)

    def test_validation_field_types(self):
        """Test validation of field types."""
        # Test with correct types - should succeed
        listing = MarketplaceListing(
            id="1234567890",
            title="Test Item",
            url="https://example.com/item/123/",
            price_numeric=100.50,
            delivery_types=["LOCAL_PICKUP"],
        )
        assert isinstance(listing.price_numeric, float)
        assert isinstance(listing.delivery_types, list)

        # Test with invalid type for price_numeric - should convert or fail
        # Pydantic v2 will try to coerce, but we should test with string
        listing2 = MarketplaceListing(
            id="1234567890",
            title="Test Item",
            url="https://example.com/item/123/",
            price_numeric="199.99",  # String should be coerced to float
        )
        assert isinstance(listing2.price_numeric, float)
        assert listing2.price_numeric == 199.99

        # Test with non-numeric string - should fail
        with pytest.raises(ValidationError):
            MarketplaceListing(
                id="1234567890",
                title="Test Item",
                url="https://example.com/item/123/",
                price_numeric="not a number",
            )

    def test_delivery_types_must_be_list(self):
        """Test that delivery_types must be a list."""
        # Should accept list
        listing = MarketplaceListing(
            id="123",
            title="Test",
            url="https://example.com/item/123/",
            delivery_types=["IN_PERSON", "SHIPPING"],
        )
        assert listing.delivery_types == ["IN_PERSON", "SHIPPING"]

        # Should coerce tuple to list
        listing2 = MarketplaceListing(
            id="123",
            title="Test",
            url="https://example.com/item/123/",
            delivery_types=("IN_PERSON",),
        )
        assert isinstance(listing2.delivery_types, list)

    def test_boolean_fields_accept_none(self):
        """Test that boolean fields can be None."""
        listing = MarketplaceListing(
            id="123",
            title="Test",
            url="https://example.com/item/123/",
            is_sold=None,
            is_pending=None,
            is_hidden=None,
        )
        assert listing.is_sold is None
        assert listing.is_pending is None
        assert listing.is_hidden is None

    def test_model_serialization(self):
        """Test that model can be serialized to JSON."""
        listing = MarketplaceListing(
            id="1234567890",
            title="iPhone 14 Pro",
            price="$899",
            is_sold=False,
            is_pending=False,
            is_hidden=False,
            category_id="electronics",
            price_numeric=899.0,
            delivery_types=["LOCAL_PICKUP"],
            price_converted="$899.00",
            url="https://www.facebook.com/marketplace/item/1234567890/",
        )

        # Serialize to dict
        data = listing.model_dump()
        assert data["id"] == "1234567890"
        assert data["is_sold"] is False
        assert data["price_numeric"] == 899.0
        assert data["delivery_types"] == ["LOCAL_PICKUP"]

        # Serialize to JSON string
        json_str = listing.model_dump_json()
        parsed = json.loads(json_str)
        assert parsed["id"] == "1234567890"
        assert parsed["category_id"] == "electronics"

    def test_model_with_partial_new_fields(self):
        """Test model with only some of the new fields set."""
        listing = MarketplaceListing(
            id="123",
            title="Partial Test",
            url="https://example.com/item/123/",
            is_sold=True,
            price_numeric=500.0,
            # Other new fields use defaults
        )

        assert listing.is_sold is True
        assert listing.is_pending is None
        assert listing.price_numeric == 500.0
        assert listing.category_id is None
        assert listing.delivery_types == []

    def test_required_fields_validation(self):
        """Test that required fields are properly validated."""
        # Missing required id
        with pytest.raises(ValidationError) as exc_info:
            MarketplaceListing(
                title="Test",
                url="https://example.com/item/123/",
            )
        assert "id" in str(exc_info.value)

        # Missing required title
        with pytest.raises(ValidationError) as exc_info:
            MarketplaceListing(
                id="123",
                url="https://example.com/item/123/",
            )
        assert "title" in str(exc_info.value)

        # Missing required url
        with pytest.raises(ValidationError) as exc_info:
            MarketplaceListing(
                id="123",
                title="Test",
            )
        assert "url" in str(exc_info.value)


class TestMarketplaceSearchResult:
    """Test cases for MarketplaceSearchResult model."""

    def test_search_result_with_listings(self):
        """Test search result containing listings with new fields."""
        listings = [
            MarketplaceListing(
                id="1",
                title="Item 1",
                url="https://example.com/item/1/",
                price_numeric=100.0,
                category_id="electronics",
            ),
            MarketplaceListing(
                id="2",
                title="Item 2",
                url="https://example.com/item/2/",
                is_sold=True,
                delivery_types=["IN_PERSON"],
            ),
        ]

        result = MarketplaceSearchResult(
            query="iphone",
            listings=listings,
            total_count=2,
            has_more=False,
        )

        assert result.query == "iphone"
        assert len(result.listings) == 2
        assert result.listings[0].price_numeric == 100.0
        assert result.listings[1].is_sold is True

    def test_empty_search_result(self):
        """Test search result with no listings."""
        result = MarketplaceSearchResult(
            query="nonexistent item",
            listings=[],
            total_count=0,
            has_more=False,
        )

        assert result.listings == []
        assert result.total_count == 0


class TestSearchFilters:
    """Test cases for SearchFilters model."""

    def test_matches_with_location_filter(self):
        """Test location matching in filters."""
        filters = SearchFilters(location="Dhaka")

        matching_listing = MarketplaceListing(
            id="1",
            title="Item",
            url="https://example.com/item/1/",
            location="Dhaka, Bangladesh",
        )

        non_matching_listing = MarketplaceListing(
            id="2",
            title="Item",
            url="https://example.com/item/2/",
            location="Chittagong",
        )

        assert filters.matches(matching_listing) is True
        assert filters.matches(non_matching_listing) is False

    def test_matches_with_price_range_filter(self):
        """Test price range filtering."""
        filters = SearchFilters(min_price=100, max_price=500)

        matching_listing = MarketplaceListing(
            id="1",
            title="Item",
            url="https://example.com/item/1/",
            price="BDT200",
            price_numeric=200.0,
        )

        too_expensive = MarketplaceListing(
            id="2",
            title="Item",
            url="https://example.com/item/2/",
            price="BDT600",
            price_numeric=600.0,
        )

        assert filters.matches(matching_listing) is True
        assert filters.matches(too_expensive) is False

    def test_matches_with_no_price(self):
        """Test filtering when listing has no price."""
        filters = SearchFilters(min_price=100)

        no_price_listing = MarketplaceListing(
            id="1",
            title="Item",
            url="https://example.com/item/1/",
            price=None,
        )

        assert filters.matches(no_price_listing) is False


class TestMarketplaceFeedItem:
    """Test cases for MarketplaceFeedItem model."""

    def test_feed_item_creation(self):
        """Test basic feed item creation."""
        item = MarketplaceFeedItem(
            type="organic",
            id="123",
            title="Test Item",
            price="$100",
            location="NYC",
            image_urls=["https://example.com/img.jpg"],
            seller_name="John",
            seller_id="456",
            url="https://example.com/item/123/",
            is_sponsored=False,
        )

        assert item.type == "organic"
        assert item.id == "123"
        assert item.is_sponsored is False


class TestMarketplaceCategory:
    """Test cases for MarketplaceCategory model."""

    def test_category_creation(self):
        """Test category creation."""
        category = MarketplaceCategory(
            id="electronics",
            name="Electronics",
            url="https://facebook.com/marketplace/electronics/",
            parent_id=None,
        )

        assert category.id == "electronics"
        assert category.name == "Electronics"
        assert category.parent_id is None


class TestMarketplaceSeller:
    """Test cases for MarketplaceSeller model."""

    def test_seller_creation(self):
        """Test seller creation with optional fields."""
        seller = MarketplaceSeller(
            id="123",
            name="John Doe",
            profile_url="https://facebook.com/john",
            rating=4.5,
            review_count=100,
        )

        assert seller.id == "123"
        assert seller.name == "John Doe"
        assert seller.rating == 4.5
        assert seller.review_count == 100
        assert seller.location is None
        assert seller.joined_date is None

    def test_seller_with_minimal_fields(self):
        """Test seller with only required fields."""
        seller = MarketplaceSeller(
            id="123",
            name="John Doe",
            profile_url="https://facebook.com/john",
        )

        assert seller.rating is None
        assert seller.review_count is None
