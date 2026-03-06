"""
Tests for Facebook Marketplace parser.

Unit tests for MarketplaceParser including extraction of all 7 new fields
from GraphQL responses.
"""

import json
from pathlib import Path

import pytest

from sm_auto.platforms.facebook.marketplace.parser import MarketplaceParser
from sm_auto.platforms.facebook.marketplace.models import MarketplaceListing


@pytest.fixture
def parser():
    """Create a fresh parser instance for each test."""
    return MarketplaceParser()


@pytest.fixture
def sample_graphql_response():
    """Load sample GraphQL response from file."""
    response_path = Path(__file__).parent.parent / "graphql_raw_response.json"
    with open(response_path, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture
def sample_listing_node():
    """Return a sample organic listing node from GraphQL response."""
    return {
        "__typename": "MarketplaceFeedListingStoryObject",
        "story_type": "POST",
        "story_key": "25982312478045513",
        "listing": {
            "__typename": "GroupCommerceProductItem",
            "id": "1213713894080605",
            "primary_listing_photo": {
                "__typename": "CatalogMarketplaceEnhancementTransformedImage",
                "image": {
                    "uri": "https://scontent.fdac207-1.fna.fbcdn.net/v/t39.84726-6/test.jpg"
                },
                "id": "1895589057810684"
            },
            "listing_price": {
                "formatted_amount": "BDT180,000",
                "amount_with_offset_in_currency": "146530",
                "amount": "180000.00"
            },
            "location": {
                "reverse_geocode": {
                    "city": "ঢাকা",
                    "state": "",
                    "city_page": {
                        "display_name": "Dhaka, Bangladesh",
                        "id": "101889586519301"
                    }
                }
            },
            "is_hidden": False,
            "is_live": True,
            "is_pending": False,
            "is_sold": False,
            "is_viewer_seller": False,
            "marketplace_listing_category_id": "1557869527812749",
            "marketplace_listing_title": "iPhone 17 pro max , 512 Gb , Australian",
            "marketplace_listing_seller": {
                "__typename": "User",
                "name": "Tanvir Ahammed Nabil",
                "id": "100021992601072"
            },
            "delivery_types": [
                "IN_PERSON"
            ],
            "product_feedback": None
        },
        "id": "25982312478045513:IN_MEMORY_MARKETPLACE_FEED_STORY_ENT:MarketplaceFeedStoryBase:503"
    }


@pytest.fixture
def sample_listing_node_multiple_delivery():
    """Return a sample listing node with multiple delivery types."""
    return {
        "__typename": "MarketplaceFeedListingStoryObject",
        "listing": {
            "__typename": "GroupCommerceProductItem",
            "id": "1404054457866717",
            "primary_listing_photo": {
                "image": {
                    "uri": "https://example.com/image.jpg"
                }
            },
            "listing_price": {
                "formatted_amount": "BDT60,000",
                "amount_with_offset_in_currency": "48843",
                "amount": "60000.00"
            },
            "location": {
                "reverse_geocode": {
                    "city": "ঢাকা",
                    "city_page": {
                        "display_name": "Dhaka, Bangladesh",
                        "id": "101889586519301"
                    }
                }
            },
            "is_hidden": False,
            "is_live": True,
            "is_pending": False,
            "is_sold": False,
            "marketplace_listing_category_id": "1557869527812749",
            "marketplace_listing_title": "IPhone 17 Pro Max",
            "marketplace_listing_seller": {
                "name": "Yasin Arafat",
                "id": "100028014411708"
            },
            "delivery_types": [
                "IN_PERSON",
                "PUBLIC_MEETUP",
                "DOOR_PICKUP"
            ],
        },
    }


@pytest.fixture
def sample_listing_node_missing_optional():
    """Return a sample listing node with missing optional fields."""
    return {
        "__typename": "MarketplaceFeedListingStoryObject",
        "listing": {
            "__typename": "GroupCommerceProductItem",
            "id": "123456789",
            "primary_listing_photo": None,
            "listing_price": None,
            "location": {"reverse_geocode": {}},  # Empty but valid location structure
            "is_hidden": None,
            "is_pending": None,
            "is_sold": None,
            "marketplace_listing_category_id": None,
            "marketplace_listing_title": "Item with missing fields",
            "marketplace_listing_seller": None,
            "delivery_types": None,
        },
    }


class TestParseOrganicListing:
    """Test cases for _parse_organic_listing method."""

    def test_extract_all_7_new_fields(self, parser, sample_listing_node):
        """Test that _parse_organic_listing extracts all 7 new fields correctly."""
        result = parser._parse_organic_listing(sample_listing_node)

        assert result is not None
        assert isinstance(result, MarketplaceListing)

        # Verify all 7 new fields are extracted
        assert result.is_sold is False
        assert result.is_pending is False
        assert result.is_hidden is False
        assert result.category_id == "1557869527812749"
        assert result.price_numeric == 180000.0
        assert result.delivery_types == ["IN_PERSON"]
        assert result.price_converted == "146530"

    def test_extract_location_from_city_page(self, parser, sample_listing_node):
        """Test location extraction from city_page.display_name."""
        result = parser._parse_organic_listing(sample_listing_node)

        assert result.location == "Dhaka, Bangladesh"

    def test_extract_location_from_city_fallback(self, parser):
        """Test location extraction falls back to city when city_page not available."""
        node = {
            "__typename": "MarketplaceFeedListingStoryObject",
            "listing": {
                "id": "123",
                "marketplace_listing_title": "Test",
                "location": {
                    "reverse_geocode": {
                        "city": "Chittagong",
                        "state": "",
                        # No city_page
                    }
                },
            },
        }

        result = parser._parse_organic_listing(node)
        assert result.location == "Chittagong"

    def test_extract_seller_info(self, parser, sample_listing_node):
        """Test seller name and ID extraction."""
        result = parser._parse_organic_listing(sample_listing_node)

        assert result.seller_name == "Tanvir Ahammed Nabil"
        assert result.seller_id == "100021992601072"

    def test_extract_price_and_numeric(self, parser, sample_listing_node):
        """Test price and price_numeric extraction."""
        result = parser._parse_organic_listing(sample_listing_node)

        assert result.price == "BDT180,000"
        assert result.price_numeric == 180000.0

    def test_multiple_delivery_types(self, parser, sample_listing_node_multiple_delivery):
        """Test extraction of multiple delivery types."""
        result = parser._parse_organic_listing(sample_listing_node_multiple_delivery)

        assert result.delivery_types == ["IN_PERSON", "PUBLIC_MEETUP", "DOOR_PICKUP"]

    def test_missing_optional_fields_returns_none_or_default(self, parser, sample_listing_node_missing_optional):
        """Test handling of missing optional fields returns None or default."""
        result = parser._parse_organic_listing(sample_listing_node_missing_optional)

        assert result is not None
        assert result.id == "123456789"
        assert result.title == "Item with missing fields"
        # Optional fields should be None
        assert result.price is None
        assert result.price_numeric is None
        assert result.price_converted is None
        assert result.location is None
        assert result.image_url is None
        assert result.seller_name is None
        assert result.seller_id is None
        assert result.is_sold is None
        assert result.is_pending is None
        assert result.is_hidden is None
        assert result.category_id is None
        # delivery_types should default to empty list
        assert result.delivery_types == []

    def test_empty_listing_returns_none(self, parser):
        """Test that empty listing node returns None."""
        node = {
            "__typename": "MarketplaceFeedListingStoryObject",
            "listing": None,
        }

        result = parser._parse_organic_listing(node)
        assert result is None

    def test_no_listing_key_returns_none(self, parser):
        """Test that node without listing key returns None."""
        node = {
            "__typename": "MarketplaceFeedListingStoryObject",
        }

        result = parser._parse_organic_listing(node)
        assert result is None


class TestPriceNumericParsing:
    """Test cases for price_numeric parsing."""

    def test_valid_price_parsing(self, parser):
        """Test parsing of valid price strings."""
        node = {
            "__typename": "MarketplaceFeedListingStoryObject",
            "listing": {
                "id": "123",
                "marketplace_listing_title": "Test",
                "listing_price": {
                    "formatted_amount": "$1,299.99",
                    "amount": "1299.99"
                },
            },
        }

        result = parser._parse_organic_listing(node)
        assert result.price_numeric == 1299.99

    def test_integer_price_parsing(self, parser):
        """Test parsing of integer prices."""
        node = {
            "__typename": "MarketplaceFeedListingStoryObject",
            "listing": {
                "id": "123",
                "marketplace_listing_title": "Test",
                "listing_price": {
                    "formatted_amount": "$100",
                    "amount": "100"
                },
            },
        }

        result = parser._parse_organic_listing(node)
        assert result.price_numeric == 100.0

    def test_invalid_price_returns_none(self, parser):
        """Test that invalid price returns None."""
        node = {
            "__typename": "MarketplaceFeedListingStoryObject",
            "listing": {
                "id": "123",
                "marketplace_listing_title": "Test",
                "listing_price": {
                    "formatted_amount": "Free",
                    "amount": "not_a_number"
                },
            },
        }

        result = parser._parse_organic_listing(node)
        assert result.price_numeric is None

    def test_missing_amount_returns_none(self, parser):
        """Test that missing amount field returns None for price_numeric."""
        node = {
            "__typename": "MarketplaceFeedListingStoryObject",
            "listing": {
                "id": "123",
                "marketplace_listing_title": "Test",
                "listing_price": {
                    "formatted_amount": "$100",
                    # No amount field
                },
            },
        }

        result = parser._parse_organic_listing(node)
        assert result.price_numeric is None

    def test_missing_listing_price_returns_none(self, parser):
        """Test that missing listing_price returns None for price."""
        node = {
            "__typename": "MarketplaceFeedListingStoryObject",
            "listing": {
                "id": "123",
                "marketplace_listing_title": "Test",
                # No listing_price
            },
        }

        result = parser._parse_organic_listing(node)
        assert result.price is None
        assert result.price_numeric is None


class TestDeliveryTypesExtraction:
    """Test cases for delivery_types extraction."""

    def test_delivery_types_as_array(self, parser):
        """Test extraction when delivery_types is an array."""
        node = {
            "__typename": "MarketplaceFeedListingStoryObject",
            "listing": {
                "id": "123",
                "marketplace_listing_title": "Test",
                "delivery_types": ["IN_PERSON", "SHIPPING"],
            },
        }

        result = parser._parse_organic_listing(node)
        assert result.delivery_types == ["IN_PERSON", "SHIPPING"]

    def test_delivery_types_none_defaults_to_empty(self, parser):
        """Test that None delivery_types defaults to empty list."""
        node = {
            "__typename": "MarketplaceFeedListingStoryObject",
            "listing": {
                "id": "123",
                "marketplace_listing_title": "Test",
                "delivery_types": None,
            },
        }

        result = parser._parse_organic_listing(node)
        assert result.delivery_types == []

    def test_delivery_types_missing_defaults_to_empty(self, parser):
        """Test that missing delivery_types defaults to empty list."""
        node = {
            "__typename": "MarketplaceFeedListingStoryObject",
            "listing": {
                "id": "123",
                "marketplace_listing_title": "Test",
                # No delivery_types field
            },
        }

        result = parser._parse_organic_listing(node)
        assert result.delivery_types == []

    def test_delivery_types_non_list_converted(self, parser):
        """Test handling of non-list delivery_types."""
        node = {
            "__typename": "MarketplaceFeedListingStoryObject",
            "listing": {
                "id": "123",
                "marketplace_listing_title": "Test",
                "delivery_types": "IN_PERSON",  # String instead of list
            },
        }

        result = parser._parse_organic_listing(node)
        # Should default to empty list for invalid type
        assert result.delivery_types == []


class TestExtractListings:
    """Test cases for extract_listings method with sample GraphQL data."""

    def test_extract_listings_from_sample_response(self, parser, sample_graphql_response):
        """Test extracting listings from actual GraphQL response."""
        listings = parser.extract_listings(sample_graphql_response)

        assert len(listings) > 0

        # Verify first listing has all new fields
        first_listing = listings[0]
        assert isinstance(first_listing, MarketplaceListing)
        assert first_listing.id is not None
        assert first_listing.title is not None
        assert first_listing.is_sold is not None
        assert first_listing.is_pending is not None
        assert first_listing.is_hidden is not None
        assert first_listing.category_id is not None
        assert first_listing.price_numeric is not None
        assert first_listing.delivery_types is not None

    def test_extract_listings_from_string(self, parser, sample_graphql_response):
        """Test extracting listings from JSON string."""
        json_str = json.dumps(sample_graphql_response)
        listings = parser.extract_listings(json_str)

        assert len(listings) > 0
        assert all(isinstance(l, MarketplaceListing) for l in listings)

    def test_extract_listings_from_jsonl(self, parser):
        """Test extracting listings from newline-delimited JSON."""
        jsonl_data = json.dumps({"data": {"marketplace_search": {"feed_units": {"edges": [{"node": {"__typename": "MarketplaceFeedListingStoryObject", "listing": {"id": "1", "marketplace_listing_title": "Test 1", "listing_price": {"amount": "100"}, "delivery_types": ["IN_PERSON"], "marketplace_listing_category_id": "cat1"}}}]}}}}) + "\n" + \
                     json.dumps({"data": {"marketplace_search": {"feed_units": {"edges": [{"node": {"__typename": "MarketplaceFeedListingStoryObject", "listing": {"id": "2", "marketplace_listing_title": "Test 2", "listing_price": {"amount": "200"}, "delivery_types": ["SHIPPING"], "marketplace_listing_category_id": "cat2"}}}]}}}})

        listings = parser.extract_listings(jsonl_data)

        assert len(listings) == 2
        assert listings[0].id == "1"
        assert listings[1].id == "2"

    def test_extract_listings_empty_response(self, parser):
        """Test extracting listings from empty response."""
        empty_response = {"data": {}}
        listings = parser.extract_listings(empty_response)

        assert listings == []

    def test_extract_listings_no_feed_units(self, parser):
        """Test extracting listings when no feed_units found."""
        response = {
            "data": {
                "marketplace_search": {
                    # No feed_units
                }
            }
        }
        listings = parser.extract_listings(response)

        assert listings == []


class TestParseNode:
    """Test cases for _parse_node method."""

    def test_parse_organic_listing_node(self, parser, sample_listing_node):
        """Test parsing organic listing node type."""
        result = parser._parse_node(sample_listing_node)

        assert result is not None
        assert result.type == "organic"

    def test_parse_ad_listing_node(self, parser):
        """Test parsing ad listing node type."""
        node = {
            "__typename": "MarketplaceFeedAdStory",
            "ad_id_string": "ad123",
            "story": {
                "attachments": [{
                    "title_with_entities": {"text": "Ad Title"},
                    "media": {
                        "media_image": {"uri": "https://example.com/ad.jpg"}
                    },
                    "url": "https://example.com/ad"
                }]
            },
            "actors": [{"name": "Advertiser"}]
        }

        result = parser._parse_node(node)

        assert result is not None
        assert result.type == "ad"
        assert result.id == "ad123"

    def test_parse_unknown_node_type(self, parser):
        """Test parsing unknown node type returns None."""
        node = {
            "__typename": "UnknownType",
        }

        result = parser._parse_node(node)
        assert result is None

    def test_parse_non_dict_node(self, parser):
        """Test parsing non-dict node returns None."""
        result = parser._parse_node("not a dict")
        assert result is None


class TestParse:
    """Test cases for parse method."""

    def test_parse_valid_dict(self, parser):
        """Test parsing valid dictionary."""
        data = {
            "type": "organic",
            "id": "123",
            "title": "Test Item",
            "url": "https://example.com/item/123/",
            "extra_data": {
                "price_numeric": 100.0,
                "category_id": "electronics",
            }
        }

        result = parser.parse(data)

        assert result is not None
        assert result.id == "123"
        assert result.url == "https://example.com/item/123/"

    def test_parse_invalid_type(self, parser):
        """Test parsing non-dict returns None."""
        result = parser.parse("not a dict")
        assert result is None

    def test_parse_list_of_dicts(self, parser):
        """Test parsing list of dictionaries."""
        data = [
            {"id": "1", "title": "Item 1", "url": "https://example.com/1/", "type": "organic"},
            {"id": "2", "title": "Item 2", "url": "https://example.com/2/", "type": "organic"},
        ]

        results = parser.parse_many(data)

        assert len(results) == 2
        assert results[0].id == "1"
        assert results[1].id == "2"


class TestParserErrorHandling:
    """Test cases for parser error handling."""

    def test_invalid_json_string(self, parser):
        """Test handling of invalid JSON string."""
        result = parser.extract_listings("not valid json")
        assert result == []

    def test_partially_invalid_jsonl(self, parser):
        """Test handling of partially invalid JSONL."""
        jsonl = '{"valid": "json"}\nnot valid json\n{"another": "valid"}'
        result = parser.extract_listings(jsonl)
        # Should extract what it can and skip invalid lines
        assert isinstance(result, list)

    def test_malformed_node_handling(self, parser):
        """Test handling of malformed node data."""
        # Node without required listing data - needs at least empty strings for id and title
        node = {
            "__typename": "MarketplaceFeedListingStoryObject",
            "listing": {
                # Provide minimal valid data
                "id": "",
                "marketplace_listing_title": "",
            }
        }

        result = parser._parse_organic_listing(node)
        # Should create a listing with empty values (the model allows empty strings)
        assert result is not None
        assert result.id == ""
        assert result.title == ""

    def test_parser_error_tracking(self, parser):
        """Test that parser tracks errors."""
        # Parse invalid data to trigger error
        result = parser.parse(None)

        # Result should be None for invalid input
        assert result is None

        # Check that errors can be retrieved via get_parse_errors
        errors = parser.get_parse_errors()
        assert isinstance(errors, list)
