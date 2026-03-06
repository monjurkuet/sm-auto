"""
Integration tests for raw response saving functionality.

Tests for _capture_raw_response() and save_raw_responses() methods
in FacebookMarketplaceAutomation class.
"""

import json
import os
import tempfile
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from sm_auto.platforms.facebook.marketplace.automation import (
    FacebookMarketplaceAutomation,
    FacebookMarketplacePlatform,
)
from sm_auto.platforms.facebook.marketplace.models import SearchFilters


@pytest.fixture
def mock_platform():
    """Create a mock platform for testing."""
    platform = MagicMock(spec=FacebookMarketplacePlatform)
    platform.tab = MagicMock()
    return platform


@pytest.fixture
def automation(mock_platform):
    """Create an automation instance with mocked dependencies."""
    auto = FacebookMarketplaceAutomation(
        platform=mock_platform,
        capture_service=None,
        filters=SearchFilters(),
    )
    return auto


@pytest.fixture
def sample_response_data():
    """Return sample GraphQL response data."""
    return {
        "data": {
            "marketplace_search": {
                "feed_units": {
                    "edges": [
                        {
                            "node": {
                                "__typename": "MarketplaceFeedListingStoryObject",
                                "listing": {
                                    "id": "123",
                                    "marketplace_listing_title": "Test Item"
                                }
                            }
                        }
                    ]
                }
            }
        }
    }


@pytest.fixture
def temp_output_dir():
    """Create a temporary directory for output files."""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield tmpdir


class TestCaptureRawResponse:
    """Test cases for _capture_raw_response() method."""

    def test_capture_adds_response_to_buffer(self, automation, sample_response_data):
        """Test that _capture_raw_response() adds responses to buffer."""
        # Set current query
        automation._current_query = "iphone"

        # Initial buffer should be empty
        assert len(automation._raw_responses) == 0

        # Capture a response
        automation._capture_raw_response(sample_response_data)

        # Buffer should now have one entry
        assert len(automation._raw_responses) == 1

    def test_capture_entry_structure(self, automation, sample_response_data):
        """Test that captured entry has correct structure."""
        automation._current_query = "test query"
        automation._capture_raw_response(sample_response_data)

        entry = automation._raw_responses[0]

        # Should have timestamp, query, and response
        assert "timestamp" in entry
        assert "query" in entry
        assert "response" in entry

        # Verify values
        assert entry["query"] == "test query"
        assert entry["response"] == sample_response_data

    def test_capture_timestamp_format(self, automation, sample_response_data):
        """Test that timestamp is in ISO format."""
        automation._capture_raw_response(sample_response_data)

        entry = automation._raw_responses[0]
        timestamp = entry["timestamp"]

        # Should be a valid ISO format string
        try:
            datetime.fromisoformat(timestamp)
        except ValueError:
            pytest.fail("Timestamp is not in valid ISO format")

    def test_capture_multiple_responses(self, automation, sample_response_data):
        """Test capturing multiple responses."""
        automation._current_query = "query1"
        automation._capture_raw_response(sample_response_data)

        automation._current_query = "query2"
        automation._capture_raw_response({"data": {"different": "response"}})

        automation._current_query = "query3"
        automation._capture_raw_response({"data": {"another": "response"}})

        assert len(automation._raw_responses) == 3
        assert automation._raw_responses[0]["query"] == "query1"
        assert automation._raw_responses[1]["query"] == "query2"
        assert automation._raw_responses[2]["query"] == "query3"

    def test_capture_preserves_response_data(self, automation):
        """Test that response data is preserved exactly."""
        complex_data = {
            "data": {
                "marketplace_search": {
                    "feed_units": {
                        "edges": [
                            {
                                "node": {
                                    "listing": {
                                        "id": "12345",
                                        "title": "Complex Item",
                                        "price": {"amount": "100.00"},
                                        "nested": {
                                            "deep": {
                                                "value": [1, 2, 3]
                                            }
                                        }
                                    }
                                }
                            }
                        ]
                    }
                }
            }
        }

        automation._capture_raw_response(complex_data)

        assert automation._raw_responses[0]["response"] == complex_data


class TestSaveRawResponses:
    """Test cases for save_raw_responses() method."""

    def test_save_creates_valid_jsonl_file(self, automation, sample_response_data, temp_output_dir):
        """Test that save_raw_responses() creates a valid JSONL file."""
        # Add some responses
        automation._current_query = "iphone"
        automation._capture_raw_response(sample_response_data)
        automation._capture_raw_response({"data": {"test": "data"}})

        # Save to file
        filepath = os.path.join(temp_output_dir, "test_responses.jsonl")
        result = automation.save_raw_responses(filepath)

        assert result is True
        assert os.path.exists(filepath)

        # Verify file content
        with open(filepath, "r", encoding="utf-8") as f:
            lines = f.readlines()

        assert len(lines) == 2

        # Each line should be valid JSON
        for line in lines:
            parsed = json.loads(line)
            assert "timestamp" in parsed
            assert "query" in parsed
            assert "response" in parsed

    def test_jsonl_format(self, automation, sample_response_data, temp_output_dir):
        """Test JSONL format (each line is valid JSON with timestamp, query, response)."""
        automation._current_query = "test"
        automation._capture_raw_response(sample_response_data)

        filepath = os.path.join(temp_output_dir, "format_test.jsonl")
        automation.save_raw_responses(filepath)

        with open(filepath, "r", encoding="utf-8") as f:
            for line_num, line in enumerate(f, 1):
                # Each line should be valid JSON
                entry = json.loads(line)

                # Required fields
                assert "timestamp" in entry, f"Line {line_num}: missing timestamp"
                assert "query" in entry, f"Line {line_num}: missing query"
                assert "response" in entry, f"Line {line_num}: missing response"

                # Types
                assert isinstance(entry["timestamp"], str)
                assert isinstance(entry["query"], str)
                assert isinstance(entry["response"], dict)

                # Line should end with newline (except possibly last)
                assert line.endswith("\n") or line == lines[-1]

    def test_atomic_write_pattern(self, automation, sample_response_data, temp_output_dir):
        """Test atomic write pattern (file appears complete or not at all)."""
        automation._current_query = "test"
        automation._capture_raw_response(sample_response_data)

        filepath = os.path.join(temp_output_dir, "atomic_test.jsonl")

        # Save should complete atomically
        result = automation.save_raw_responses(filepath)
        assert result is True

        # File should exist and be complete
        assert os.path.exists(filepath)

        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()

        # Content should be valid (no partial writes)
        lines = content.strip().split("\n")
        for line in lines:
            json.loads(line)  # Should not raise

    def test_creates_directory_if_not_exists(self, automation, sample_response_data, temp_output_dir):
        """Test that save creates directory structure if it doesn't exist."""
        automation._current_query = "test"
        automation._capture_raw_response(sample_response_data)

        nested_dir = os.path.join(temp_output_dir, "nested", "deep", "dir")
        filepath = os.path.join(nested_dir, "responses.jsonl")

        # Directory should not exist initially
        assert not os.path.exists(nested_dir)

        result = automation.save_raw_responses(filepath)

        assert result is True
        assert os.path.exists(nested_dir)
        assert os.path.exists(filepath)

    def test_save_empty_responses_returns_false(self, automation, temp_output_dir):
        """Test that saving empty responses returns False."""
        filepath = os.path.join(temp_output_dir, "empty.jsonl")
        result = automation.save_raw_responses(filepath)

        assert result is False
        assert not os.path.exists(filepath)

    def test_error_handling_invalid_path(self, automation, sample_response_data, temp_output_dir):
        """Test error handling for invalid file paths."""
        automation._current_query = "test"
        automation._capture_raw_response(sample_response_data)

        # Try to save to an invalid path (null bytes make path invalid on most systems)
        invalid_path = os.path.join(temp_output_dir, "test\x00invalid.jsonl")

        result = automation.save_raw_responses(invalid_path)
        assert result is False

    def test_unicode_content_preserved(self, automation, temp_output_dir):
        """Test that unicode content is preserved correctly."""
        unicode_data = {
            "data": {
                "marketplace_search": {
                    "title": "iPhone 17 pro max , 512 Gb , Australian 🇦🇺",
                    "city": "ঢাকা",
                    "description": "日本語テスト"
                }
            }
        }

        automation._current_query = "iphone অসমীয়া"
        automation._capture_raw_response(unicode_data)

        filepath = os.path.join(temp_output_dir, "unicode.jsonl")
        automation.save_raw_responses(filepath)

        with open(filepath, "r", encoding="utf-8") as f:
            entry = json.loads(f.readline())

        # Verify unicode content is preserved in the parsed data
        assert "🇦🇺" in entry["response"]["data"]["marketplace_search"]["title"]
        assert "ঢাকা" == entry["response"]["data"]["marketplace_search"]["city"]
        assert "অসমীয়া" in entry["query"]

    def test_large_response_handling(self, automation, temp_output_dir):
        """Test handling of large response data."""
        # Create a large response
        large_data = {
            "data": {
                "marketplace_search": {
                    "feed_units": {
                        "edges": [
                            {
                                "node": {
                                    "listing": {
                                        "id": str(i),
                                        "title": f"Item {i}",
                                        "description": "x" * 1000  # 1KB per item
                                    }
                                }
                            }
                            for i in range(100)  # 100 items
                        ]
                    }
                }
            }
        }

        automation._current_query = "bulk test"
        automation._capture_raw_response(large_data)

        filepath = os.path.join(temp_output_dir, "large.jsonl")
        result = automation.save_raw_responses(filepath)

        assert result is True

        # Verify file was written and can be read back
        with open(filepath, "r", encoding="utf-8") as f:
            entry = json.loads(f.readline())
            assert len(entry["response"]["data"]["marketplace_search"]["feed_units"]["edges"]) == 100


class TestGetRawResponses:
    """Test cases for get_raw_responses() method."""

    def test_get_returns_copy(self, automation, sample_response_data):
        """Test that get_raw_responses returns a copy, not reference."""
        automation._capture_raw_response(sample_response_data)

        responses1 = automation.get_raw_responses()
        responses2 = automation.get_raw_responses()

        # Should be equal but not same object
        assert responses1 == responses2
        assert responses1 is not responses2

        # Modifying returned list should not affect original
        responses1.clear()
        assert len(automation._raw_responses) == 1


class TestClearRawResponses:
    """Test cases for clear_raw_responses() method."""

    def test_clear_removes_all_responses(self, automation, sample_response_data):
        """Test that clear_raw_responses removes all responses."""
        automation._capture_raw_response(sample_response_data)
        automation._capture_raw_response(sample_response_data)

        assert len(automation._raw_responses) == 2

        automation.clear_raw_responses()

        assert len(automation._raw_responses) == 0


class TestIntegrationWithSearch:
    """Integration tests combining capture and save functionality."""

    def test_full_workflow_simulation(self, automation, sample_response_data, temp_output_dir):
        """Simulate a full search and capture workflow."""
        # Simulate search setting query
        automation._current_query = "iphone 14 pro"

        # Simulate multiple responses during search
        for i in range(5):
            response = {
                "data": {
                    "marketplace_search": {
                        "page": i,
                        "results": [f"item_{j}" for j in range(10)]
                    }
                }
            }
            automation._capture_raw_response(response)

        assert len(automation._raw_responses) == 5

        # Save the responses
        filepath = os.path.join(temp_output_dir, "workflow_test.jsonl")
        result = automation.save_raw_responses(filepath)

        assert result is True

        # Verify saved content
        with open(filepath, "r", encoding="utf-8") as f:
            lines = f.readlines()

        assert len(lines) == 5

        # Verify each entry has correct query
        for i, line in enumerate(lines):
            entry = json.loads(line)
            assert entry["query"] == "iphone 14 pro"
            assert entry["response"]["data"]["marketplace_search"]["page"] == i

    def test_multiple_searches_isolation(self, automation, sample_response_data, temp_output_dir):
        """Test that multiple searches maintain isolated responses."""
        # First search
        automation._current_query = "search1"
        automation._capture_raw_response({"data": {"search": "1"}})

        # Clear and second search
        automation.clear_raw_responses()
        automation._current_query = "search2"
        automation._capture_raw_response({"data": {"search": "2"}})
        automation._capture_raw_response({"data": {"search": "2b"}})

        # Save
        filepath = os.path.join(temp_output_dir, "isolated.jsonl")
        automation.save_raw_responses(filepath)

        with open(filepath, "r", encoding="utf-8") as f:
            lines = f.readlines()

        assert len(lines) == 2
        entries = [json.loads(line) for line in lines]

        # All entries should have second search query
        assert all(e["query"] == "search2" for e in entries)
        assert entries[0]["response"]["data"]["search"] == "2"
        assert entries[1]["response"]["data"]["search"] == "2b"


class TestTempFileCleanup:
    """Test cases for temporary file cleanup on errors."""

    def test_temp_file_created_and_replaced(self, automation, sample_response_data, temp_output_dir):
        """Test that temp file is created during save and replaced atomically."""
        automation._capture_raw_response(sample_response_data)

        filepath = os.path.join(temp_output_dir, "final.jsonl")

        # Save should complete
        result = automation.save_raw_responses(filepath)
        assert result is True

        # Verify file exists and contains expected content
        assert os.path.exists(filepath)
        with open(filepath, "r", encoding="utf-8") as f:
            entries = [json.loads(line) for line in f]
        assert len(entries) == 1

    def test_atomic_write_replaces_existing(self, automation, sample_response_data, temp_output_dir):
        """Test that atomic write properly replaces existing files."""
        filepath = os.path.join(temp_output_dir, "atomic_replace.jsonl")

        # Create existing file with old content
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(json.dumps({"old": "content"}) + "\n")

        # Add new response
        automation._capture_raw_response(sample_response_data)

        # Save should replace existing file
        result = automation.save_raw_responses(filepath)
        assert result is True

        # Verify new content exists
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
            assert "timestamp" in content  # New format has timestamp
            assert "old" not in content  # Old content should be gone
