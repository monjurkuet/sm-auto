"""MongoDB storage backend using Motor (async MongoDB driver)."""

import os
from datetime import datetime
from typing import List, Any, Optional

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError
from pymongo import ASCENDING

from sm_auto.utils.storage.base import StorageBackend
from sm_auto.utils.logger import get_logger

logger = get_logger(__name__)


class MongoDBStorage(StorageBackend):
    """Store data in MongoDB using Motor async driver."""

    def __init__(
        self,
        uri: Optional[str] = None,
        database: str = "sm_auto",
        collection: str = "listings",
    ):
        self.uri = uri or os.getenv("MONGODB_URI")
        self.database_name = database
        self.collection_name = collection
        self._client: Optional[AsyncIOMotorClient] = None
        self._collection = None

        if not self.uri:
            raise ValueError(
                "MongoDB URI not provided. Set MONGODB_URI in .env file "
                "or pass uri parameter."
            )

    async def connect(self):
        """Establish MongoDB connection."""
        self._client = AsyncIOMotorClient(self.uri, serverSelectionTimeoutMS=5000)
        # Verify connection
        await self._client.admin.command("ping")
        db = self._client[self.database_name]
        self._collection = db[self.collection_name]
        
        # Create indexes
        await self._collection.create_index("id", unique=True)
        await self._collection.create_index([("scraped_at", ASCENDING)])
        await self._collection.create_index("query")
        await self._collection.create_index([("is_sold", ASCENDING)])
        await self._collection.create_index([("is_pending", ASCENDING)])
        await self._collection.create_index([("is_hidden", ASCENDING)])
        await self._collection.create_index([("category_id", ASCENDING)])
        await self._collection.create_index([("price_numeric", ASCENDING)])
        
        logger.info(f"Connected to MongoDB: {self.database_name}.{self.collection_name}")

    async def save(self, data: List[Any], metadata: dict = None) -> str:
        """Save data to MongoDB."""
        try:
            if self._collection is None:
                await self.connect()

            metadata = metadata or {}
            inserted_count = 0
            updated_count = 0

            for item in data:
                if hasattr(item, "model_dump"):
                    doc = item.model_dump(mode="json")
                else:
                    doc = dict(item)

                doc["_metadata"] = {
                    "query": metadata.get("query"),
                    "platform": metadata.get("platform"),
                    "scraped_session": metadata.get("session_id"),
                }

                try:
                    result = await self._collection.update_one(
                        {"id": doc["id"]},
                        {"$set": doc, "$setOnInsert": {"first_seen": datetime.now()}},
                        upsert=True,
                    )
                    # Handle Motor result properly - result is a dict-like object
                    upserted_count = result.get('upsertedCount', 0) if hasattr(result, 'get') else 0
                    modified_count = result.get('modifiedCount', 0) if hasattr(result, 'get') else 0
                    if upserted_count and upserted_count > 0:
                        inserted_count += 1
                    elif modified_count and modified_count > 0:
                        updated_count += 1
                except DuplicateKeyError:
                    logger.warning(f"Duplicate listing id: {doc['id']}")
                except Exception as e:
                    logger.error(f"Error saving document {doc.get('id')}: {e}")
                    raise

            logger.info(
                f"MongoDB: Inserted {inserted_count}, Updated {updated_count}, "
                f"Total processed: {len(data)}"
            )
            return f"{self.database_name}.{self.collection_name}"
        except Exception as e:
            logger.exception(f"MongoDB save failed: {e}")
            raise

    async def close(self):
        """Close MongoDB connection."""
        if self._client:
            self._client.close()
            logger.debug("MongoDB connection closed")
