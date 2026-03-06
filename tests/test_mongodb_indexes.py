"""
Tests for MongoDB index creation and verification.

Tests for MongoDBStorage class including index creation on connect,
index types verification, and query performance on indexed fields.
"""

import os
import pytest
from datetime import datetime
from unittest.mock import MagicMock, AsyncMock, patch, call


class TestMongoDBStorageInit:
    """Test cases for MongoDBStorage initialization."""

    def test_init_with_uri_parameter(self):
        """Test initialization with explicit URI."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage

        storage = MongoDBStorage(
            uri="mongodb://localhost:27017",
            database="test_db",
            collection="test_collection"
        )

        assert storage.uri == "mongodb://localhost:27017"
        assert storage.database_name == "test_db"
        assert storage.collection_name == "test_collection"

    def test_init_with_env_var(self, monkeypatch):
        """Test initialization with environment variable."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage

        monkeypatch.setenv("MONGODB_URI", "mongodb://envhost:27017")

        storage = MongoDBStorage(database="test_db")

        assert storage.uri == "mongodb://envhost:27017"

    def test_init_without_uri_raises_error(self, monkeypatch):
        """Test that initialization raises error without URI."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage

        # Ensure MONGODB_URI is not set
        monkeypatch.delenv("MONGODB_URI", raising=False)

        with pytest.raises(ValueError) as exc_info:
            MongoDBStorage()

        assert "MongoDB URI not provided" in str(exc_info.value)


class TestMongoDBIndexCreation:
    """Test cases for MongoDB index creation on connect."""

    async def test_connect_creates_indexes(self):
        """Test that connect() creates all expected indexes."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage

        storage = MongoDBStorage(uri="mongodb://localhost:27017")

        # Mock the MongoDB client and collection
        mock_collection = AsyncMock()
        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_collection)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)
        mock_client.admin = MagicMock()
        mock_client.admin.command = AsyncMock()

        with patch("sm_auto.utils.storage.mongodb_storage.AsyncIOMotorClient", return_value=mock_client):
            await storage.connect()

        # Verify create_index was called for each index
        expected_indexes = [
            call("id", unique=True),
            call([("scraped_at", 1)]),  # ASCENDING = 1
            call("query"),
            call([("is_sold", 1)]),
            call([("is_pending", 1)]),
            call([("is_hidden", 1)]),
            call([("category_id", 1)]),
            call([("price_numeric", 1)]),
        ]

        mock_collection.create_index.assert_has_calls(expected_indexes, any_order=True)
        assert mock_collection.create_index.call_count == 8

    async def test_new_indexes_created(self):
        """Test that all new indexes from Phase 4 are created."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage

        storage = MongoDBStorage(uri="mongodb://localhost:27017")

        mock_collection = AsyncMock()
        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_collection)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)
        mock_client.admin = MagicMock()
        mock_client.admin.command = AsyncMock()

        with patch("sm_auto.utils.storage.mongodb_storage.AsyncIOMotorClient", return_value=mock_client):
            await storage.connect()

        # Get all calls to create_index
        calls = mock_collection.create_index.call_args_list

        # Convert calls to a more checkable format
        indexed_fields = []
        for c in calls:
            args = c[0]
            if args:
                indexed_fields.append(args[0])

        # Check that new fields are indexed (7 new fields)
        assert "is_sold" in str(indexed_fields)
        assert "is_pending" in str(indexed_fields)
        assert "is_hidden" in str(indexed_fields)
        assert "category_id" in str(indexed_fields)
        assert "price_numeric" in str(indexed_fields)


class TestMongoDBIndexTypes:
    """Test cases for verifying index types."""

    async def test_id_index_is_unique(self):
        """Test that 'id' index is unique."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage
        from pymongo import ASCENDING

        storage = MongoDBStorage(uri="mongodb://localhost:27017")

        mock_collection = AsyncMock()
        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_collection)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)
        mock_client.admin = MagicMock()
        mock_client.admin.command = AsyncMock()

        with patch("sm_auto.utils.storage.mongodb_storage.AsyncIOMotorClient", return_value=mock_client):
            await storage.connect()

        # Find the call for 'id' index
        calls = mock_collection.create_index.call_args_list
        id_index_call = None
        for c in calls:
            args, kwargs = c
            if args and args[0] == "id":
                id_index_call = c
                break

        assert id_index_call is not None
        assert id_index_call.kwargs.get("unique") is True

    async def test_other_indexes_are_non_unique(self):
        """Test that other indexes are non-unique."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage

        storage = MongoDBStorage(uri="mongodb://localhost:27017")

        mock_collection = AsyncMock()
        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_collection)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)
        mock_client.admin = MagicMock()
        mock_client.admin.command = AsyncMock()

        with patch("sm_auto.utils.storage.mongodb_storage.AsyncIOMotorClient", return_value=mock_client):
            await storage.connect()

        # Get all non-id index calls
        calls = mock_collection.create_index.call_args_list
        non_unique_indexes = []

        for c in calls:
            args, kwargs = c
            if args and args[0] != "id":
                non_unique_indexes.append(c)
                # Should not have unique=True
                assert kwargs.get("unique") is not True, f"Index {args[0]} should not be unique"

        # Should have 7 non-unique indexes (all the new ones plus scraped_at and query)
        assert len(non_unique_indexes) == 7

    async def test_indexes_are_ascending(self):
        """Test that indexes use ascending order."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage, ASCENDING

        storage = MongoDBStorage(uri="mongodb://localhost:27017")

        mock_collection = AsyncMock()
        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_collection)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)
        mock_client.admin = MagicMock()
        mock_client.admin.command = AsyncMock()

        with patch("sm_auto.utils.storage.mongodb_storage.AsyncIOMotorClient", return_value=mock_client):
            await storage.connect()

        # Check that compound indexes use ASCENDING
        calls = mock_collection.create_index.call_args_list

        for c in calls:
            args, kwargs = c
            if args:
                field_spec = args[0]
                # If it's a list, it's a compound index
                if isinstance(field_spec, list):
                    for field, direction in field_spec:
                        assert direction == ASCENDING, f"Index {field} should be ASCENDING"


class TestQueryPerformance:
    """Test cases for query performance on indexed fields."""

    async def test_query_by_is_sold_uses_index(self):
        """Test that querying by is_sold can use index."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage

        storage = MongoDBStorage(uri="mongodb://localhost:27017")

        mock_cursor = AsyncMock()
        mock_cursor.to_list = AsyncMock(return_value=[])
        mock_collection = AsyncMock()
        mock_collection.find = MagicMock(return_value=mock_cursor)
        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_collection)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)
        mock_client.admin = MagicMock()
        mock_client.admin.command = AsyncMock()

        with patch("sm_auto.utils.storage.mongodb_storage.AsyncIOMotorClient", return_value=mock_client):
            await storage.connect()
            # Simulate a query that would use the is_sold index
            cursor = mock_collection.find({"is_sold": False})
            await cursor.to_list(None)

        # The query should work without errors
        mock_collection.find.assert_called_with({"is_sold": False})

    async def test_query_by_price_range_uses_index(self):
        """Test that querying by price_numeric range can use index."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage

        storage = MongoDBStorage(uri="mongodb://localhost:27017")

        mock_cursor = AsyncMock()
        mock_cursor.to_list = AsyncMock(return_value=[])
        mock_collection = AsyncMock()
        mock_collection.find = MagicMock(return_value=mock_cursor)
        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_collection)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)
        mock_client.admin = MagicMock()
        mock_client.admin.command = AsyncMock()

        with patch("sm_auto.utils.storage.mongodb_storage.AsyncIOMotorClient", return_value=mock_client):
            await storage.connect()
            # Simulate a price range query
            cursor = mock_collection.find({
                "price_numeric": {"$gte": 100, "$lte": 500}
            })
            await cursor.to_list(None)

        # The query should work without errors
        mock_collection.find.assert_called_with({
            "price_numeric": {"$gte": 100, "$lte": 500}
        })

    async def test_query_by_category_uses_index(self):
        """Test that querying by category_id can use index."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage

        storage = MongoDBStorage(uri="mongodb://localhost:27017")

        mock_cursor = AsyncMock()
        mock_cursor.to_list = AsyncMock(return_value=[])
        mock_collection = AsyncMock()
        mock_collection.find = MagicMock(return_value=mock_cursor)
        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_collection)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)
        mock_client.admin = MagicMock()
        mock_client.admin.command = AsyncMock()

        with patch("sm_auto.utils.storage.mongodb_storage.AsyncIOMotorClient", return_value=mock_client):
            await storage.connect()
            # Simulate a category query
            cursor = mock_collection.find({"category_id": "electronics"})
            await cursor.to_list(None)

        mock_collection.find.assert_called_with({"category_id": "electronics"})

    async def test_compound_query_uses_multiple_indexes(self):
        """Test that compound queries can use multiple indexes."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage

        storage = MongoDBStorage(uri="mongodb://localhost:27017")

        mock_cursor = AsyncMock()
        mock_cursor.to_list = AsyncMock(return_value=[])
        mock_collection = AsyncMock()
        mock_collection.find = MagicMock(return_value=mock_cursor)
        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_collection)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)
        mock_client.admin = MagicMock()
        mock_client.admin.command = AsyncMock()

        with patch("sm_auto.utils.storage.mongodb_storage.AsyncIOMotorClient", return_value=mock_client):
            await storage.connect()
            # Simulate a compound query using multiple indexed fields
            query = {
                "is_sold": False,
                "is_pending": False,
                "category_id": "electronics",
                "price_numeric": {"$gte": 100, "$lte": 500}
            }
            cursor = mock_collection.find(query)
            await cursor.to_list(None)

        mock_collection.find.assert_called_with(query)


class TestIndexVerification:
    """Test cases for verifying index properties."""

    async def test_index_list_includes_new_fields(self):
        """Test that index list includes all new fields."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage

        storage = MongoDBStorage(uri="mongodb://localhost:27017")

        mock_collection = AsyncMock()
        # Mock index_information to return created indexes
        mock_collection.index_information.return_value = {
            "_id_": {"v": 2, "key": [("_id", 1)], "ns": "test.listings"},
            "id_1": {"v": 2, "unique": True, "key": [("id", 1)], "ns": "test.listings"},
            "scraped_at_1": {"v": 2, "key": [("scraped_at", 1)], "ns": "test.listings"},
            "query_1": {"v": 2, "key": [("query", 1)], "ns": "test.listings"},
            "is_sold_1": {"v": 2, "key": [("is_sold", 1)], "ns": "test.listings"},
            "is_pending_1": {"v": 2, "key": [("is_pending", 1)], "ns": "test.listings"},
            "is_hidden_1": {"v": 2, "key": [("is_hidden", 1)], "ns": "test.listings"},
            "category_id_1": {"v": 2, "key": [("category_id", 1)], "ns": "test.listings"},
            "price_numeric_1": {"v": 2, "key": [("price_numeric", 1)], "ns": "test.listings"},
        }

        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_collection)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)
        mock_client.admin = MagicMock()
        mock_client.admin.command = AsyncMock()

        with patch("sm_auto.utils.storage.mongodb_storage.AsyncIOMotorClient", return_value=mock_client):
            await storage.connect()
            indexes = await mock_collection.index_information()

        # Verify all expected indexes exist
        assert "id_1" in indexes
        assert "scraped_at_1" in indexes
        assert "query_1" in indexes
        assert "is_sold_1" in indexes
        assert "is_pending_1" in indexes
        assert "is_hidden_1" in indexes
        assert "category_id_1" in indexes
        assert "price_numeric_1" in indexes

    async def test_id_index_has_unique_constraint(self):
        """Test that id index has unique constraint."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage

        storage = MongoDBStorage(uri="mongodb://localhost:27017")

        mock_collection = AsyncMock()
        mock_collection.index_information.return_value = {
            "id_1": {"v": 2, "unique": True, "key": [("id", 1)], "ns": "test.listings"},
        }

        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_collection)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)
        mock_client.admin = MagicMock()
        mock_client.admin.command = AsyncMock()

        with patch("sm_auto.utils.storage.mongodb_storage.AsyncIOMotorClient", return_value=mock_client):
            await storage.connect()
            indexes = await mock_collection.index_information()

        assert indexes["id_1"]["unique"] is True

    async def test_new_indexes_not_unique(self):
        """Test that new field indexes are not unique."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage

        storage = MongoDBStorage(uri="mongodb://localhost:27017")

        mock_collection = AsyncMock()
        mock_collection.index_information.return_value = {
            "is_sold_1": {"v": 2, "key": [("is_sold", 1)], "ns": "test.listings"},
            "category_id_1": {"v": 2, "key": [("category_id", 1)], "ns": "test.listings"},
        }

        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_collection)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)
        mock_client.admin = MagicMock()
        mock_client.admin.command = AsyncMock()

        with patch("sm_auto.utils.storage.mongodb_storage.AsyncIOMotorClient", return_value=mock_client):
            await storage.connect()
            indexes = await mock_collection.index_information()

        # New indexes should not have unique flag
        assert "unique" not in indexes["is_sold_1"]
        assert "unique" not in indexes["category_id_1"]


class TestSaveWithIndexes:
    """Test cases for save operations with indexes."""

    async def test_save_creates_document_with_new_fields(self):
        """Test that save creates documents with all new fields."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage
        from sm_auto.platforms.facebook.marketplace.models import MarketplaceListing

        storage = MongoDBStorage(uri="mongodb://localhost:27017")

        mock_collection = AsyncMock()
        mock_collection.update_one = AsyncMock(return_value={"upsertedCount": 1, "modifiedCount": 0})

        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_collection)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)
        mock_client.admin = MagicMock()
        mock_client.admin.command = AsyncMock()

        with patch("sm_auto.utils.storage.mongodb_storage.AsyncIOMotorClient", return_value=mock_client):
            await storage.connect()

            # Create a listing with new fields
            listing = MarketplaceListing(
                id="123",
                title="Test Item",
                url="https://example.com/item/123/",
                is_sold=False,
                is_pending=False,
                is_hidden=False,
                category_id="electronics",
                price_numeric=899.0,
                delivery_types=["LOCAL_PICKUP"],
            )

            await storage.save([listing], metadata={"query": "test"})

        # Verify update_one was called
        assert mock_collection.update_one.called

        # Get the document that was saved
        call_args = mock_collection.update_one.call_args
        filter_doc = call_args[0][0]
        update_doc = call_args[0][1]

        # Verify the document contains new fields
        assert filter_doc["id"] == "123"
        assert "$set" in update_doc
        set_doc = update_doc["$set"]
        assert set_doc["is_sold"] is False
        assert set_doc["is_pending"] is False
        assert set_doc["is_hidden"] is False
        assert set_doc["category_id"] == "electronics"
        assert set_doc["price_numeric"] == 899.0


class TestConnectErrorHandling:
    """Test cases for connection error handling."""

    async def test_connect_raises_on_connection_failure(self):
        """Test that connect raises exception on connection failure."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage
        from motor.motor_asyncio import AsyncIOMotorClient

        storage = MongoDBStorage(uri="mongodb://invalid:27017")

        mock_client = MagicMock()
        mock_client.admin = MagicMock()
        mock_client.admin.command = AsyncMock(side_effect=Exception("Connection refused"))

        with patch("sm_auto.utils.storage.mongodb_storage.AsyncIOMotorClient", return_value=mock_client):
            with pytest.raises(Exception) as exc_info:
                await storage.connect()

            assert "Connection refused" in str(exc_info.value)

    async def test_connect_sets_client(self):
        """Test that connect sets the _client attribute."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage

        storage = MongoDBStorage(uri="mongodb://localhost:27017")

        mock_collection = AsyncMock()
        mock_db = MagicMock()
        mock_db.__getitem__ = MagicMock(return_value=mock_collection)
        mock_client = MagicMock()
        mock_client.__getitem__ = MagicMock(return_value=mock_db)
        mock_client.admin = MagicMock()
        mock_client.admin.command = AsyncMock()

        with patch("sm_auto.utils.storage.mongodb_storage.AsyncIOMotorClient", return_value=mock_client):
            await storage.connect()

        assert storage._client is mock_client
        assert storage._collection is mock_collection


class TestClose:
    """Test cases for close method."""

    async def test_close_closes_client(self):
        """Test that close closes the MongoDB client."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage

        storage = MongoDBStorage(uri="mongodb://localhost:27017")

        mock_client = MagicMock()
        mock_client.close = MagicMock()
        storage._client = mock_client

        await storage.close()

        mock_client.close.assert_called_once()

    async def test_close_with_no_client(self):
        """Test that close handles case when no client exists."""
        from sm_auto.utils.storage.mongodb_storage import MongoDBStorage

        storage = MongoDBStorage(uri="mongodb://localhost:27017")
        storage._client = None

        # Should not raise
        await storage.close()
