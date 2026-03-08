"""
Facebook Page Storage.

Storage backend for Facebook page tracking with specialized query methods
for the facebook_pages and facebook_page_metrics collections.
"""

import os
import re
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError
from pymongo import ASCENDING, DESCENDING

from sm_auto.platforms.facebook.page.models import FacebookPage, FacebookPageMetric
from sm_auto.utils.logger import get_logger

logger = get_logger(__name__)


class FacebookPageStorage:
    """
    Storage for Facebook page tracking.

    Manages three collections:
    - facebook_pages: Page metadata
    - facebook_page_metrics: Time-series metrics
    - facebook_page_posts: Individual posts
    """

    PAGES_COLLECTION = "facebook_pages"
    METRICS_COLLECTION = "facebook_page_metrics"
    POSTS_COLLECTION = "facebook_page_posts"

    def __init__(
        self,
        uri: Optional[str] = None,
        database: str = "sm_auto",
    ):
        """
        Initialize the storage.

        Args:
            uri: MongoDB connection URI. Defaults to MONGODB_URI env var.
            database: Database name.
        """
        self.uri = uri or os.getenv("MONGODB_URI")
        self.database_name = database
        self._client: Optional[AsyncIOMotorClient] = None
        self._db = None

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
        self._db = self._client[self.database_name]

        # Create indexes for pages collection
        pages = self._db[self.PAGES_COLLECTION]
        await pages.create_index("page_id", unique=True)
        await pages.create_index("page_url")
        await pages.create_index("username")
        await pages.create_index("last_checked")
        await pages.create_index("first_seen")

        # Create indexes for metrics collection
        metrics = self._db[self.METRICS_COLLECTION]
        await metrics.create_index("page_id")
        await metrics.create_index([("page_id", ASCENDING), ("recorded_at", DESCENDING)])
        await metrics.create_index("recorded_at")

        # Create indexes for posts collection
        posts = self._db[self.POSTS_COLLECTION]
        await posts.create_index("post_id", unique=True)
        await posts.create_index("page_id")
        await posts.create_index([("page_id", ASCENDING), ("recorded_at", DESCENDING)])
        await posts.create_index("created_at_timestamp")
        await posts.create_index("recorded_at")

        logger.info(
            f"Connected to MongoDB: {self.database_name} "
            f"(collections: {self.PAGES_COLLECTION}, {self.METRICS_COLLECTION}, {self.POSTS_COLLECTION})"
        )

    @property
    def pages(self):
        """Get pages collection."""
        if self._db is None:
            raise RuntimeError("Not connected. Call connect() first.")
        return self._db[self.PAGES_COLLECTION]

    @property
    def metrics(self):
        """Get metrics collection."""
        if self._db is None:
            raise RuntimeError("Not connected. Call connect() first.")
        return self._db[self.METRICS_COLLECTION]

    @property
    def posts(self):
        """Get posts collection."""
        if self._db is None:
            raise RuntimeError("Not connected. Call connect() first.")
        return self._db[self.POSTS_COLLECTION]

    # === Page Operations ===

    async def upsert_page(self, page_data: Dict[str, Any]) -> bool:
        """
        Insert or update a page.

        Args:
            page_data: Page data dictionary.

        Returns:
            True if successful.
        """
        if self._db is None:
            await self.connect()

        page_id = page_data.get("page_id")
        if not page_id:
            logger.error("Cannot upsert page without page_id")
            return False

        now = datetime.utcnow()

        # Build update document
        update_doc = {
            "$set": {
                key: value
                for key, value in page_data.items()
                if key != "page_id" and value is not None
            },
            "$setOnInsert": {
                "first_seen": now,
            },
        }

        # Always update last_checked
        update_doc["$set"]["last_checked"] = now

        try:
            await self.pages.update_one(
                {"page_id": page_id},
                update_doc,
                upsert=True,
            )
            logger.debug(f"Upserted page: {page_id}")
            return True
        except Exception as e:
            logger.error(f"Error upserting page {page_id}: {e}")
            raise

    async def get_page_by_id(self, page_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a page by page_id.

        Args:
            page_id: The Facebook page ID.

        Returns:
            Page document or None.
        """
        if self._db is None:
            await self.connect()

        return await self.pages.find_one({"page_id": page_id})

    async def get_page_by_url(self, url: str) -> Optional[Dict[str, Any]]:
        """
        Get a page by URL.

        Args:
            url: The page URL.

        Returns:
            Page document or None.
        """
        if self._db is None:
            await self.connect()

        return await self.pages.find_one({"page_url": url})

    async def get_all_pages(self) -> List[Dict[str, Any]]:
        """
        Get all tracked pages.

        Returns:
            List of page documents.
        """
        if self._db is None:
            await self.connect()

        cursor = self.pages.find({})
        return await cursor.to_list(length=None)

    async def get_stale_pages(self, hours: int = 24) -> List[Dict[str, Any]]:
        """
        Get pages not checked in specified hours.

        Args:
            hours: Number of hours to consider stale.

        Returns:
            List of stale page documents.
        """
        if self._db is None:
            await self.connect()

        cutoff = datetime.utcnow() - timedelta(hours=hours)
        cursor = self.pages.find({"last_checked": {"$lt": cutoff}})
        return await cursor.to_list(length=None)

    async def delete_page(self, page_id: str) -> bool:
        """
        Delete a page and its metrics.

        Args:
            page_id: The page ID to delete.

        Returns:
            True if successful.
        """
        if self._db is None:
            await self.connect()

        # Delete page
        result = await self.pages.delete_one({"page_id": page_id})

        # Delete associated metrics
        await self.metrics.delete_many({"page_id": page_id})

        logger.info(f"Deleted page {page_id} and its metrics")
        return result.deleted_count > 0

    # === Metric Operations ===

    async def insert_metric(self, metric_data: Dict[str, Any]) -> bool:
        """
        Insert a new metric record.

        Args:
            metric_data: Metric data dictionary.

        Returns:
            True if successful.
        """
        if self._db is None:
            await self.connect()

        metric_data["recorded_at"] = datetime.utcnow()

        try:
            await self.metrics.insert_one(metric_data)
            logger.debug(f"Inserted metric for page: {metric_data.get('page_id')}")
            return True
        except Exception as e:
            logger.error(f"Error inserting metric: {e}")
            raise

    async def get_latest_metric(self, page_id: str) -> Optional[Dict[str, Any]]:
        """
        Get the most recent metric for a page.

        Args:
            page_id: The page ID.

        Returns:
            Latest metric document or None.
        """
        if self._db is None:
            await self.connect()

        return await self.metrics.find_one(
            {"page_id": page_id},
            sort=[("recorded_at", DESCENDING)],
        )

    async def get_metrics_history(
        self,
        page_id: str,
        limit: int = 30,
    ) -> List[Dict[str, Any]]:
        """
        Get metric history for a page.

        Args:
            page_id: The page ID.
            limit: Maximum number of records to return.

        Returns:
            List of metric documents, newest first.
        """
        if self._db is None:
            await self.connect()

        cursor = self.metrics.find(
            {"page_id": page_id},
            sort=[("recorded_at", DESCENDING)],
            limit=limit,
        )
        return await cursor.to_list(length=None)

    async def get_metrics_in_range(
        self,
        page_id: str,
        start_date: datetime,
        end_date: datetime,
    ) -> List[Dict[str, Any]]:
        """
        Get metrics within a date range.

        Args:
            page_id: The page ID.
            start_date: Start of range.
            end_date: End of range.

        Returns:
            List of metric documents.
        """
        if self._db is None:
            await self.connect()

        cursor = self.metrics.find(
            {
                "page_id": page_id,
                "recorded_at": {
                    "$gte": start_date,
                    "$lte": end_date,
                },
            },
            sort=[("recorded_at", ASCENDING)],
        )
        return await cursor.to_list(length=None)

    # === Bulk Operations ===

    async def get_page_count(self) -> int:
        """
        Get total number of tracked pages.

        Returns:
            Count of pages.
        """
        if self._db is None:
            await self.connect()

        return await self.pages.count_documents({})

    async def get_metrics_count(self, page_id: str) -> int:
        """
        Get total number of metrics for a page.

        Args:
            page_id: The page ID.

        Returns:
            Count of metrics.
        """
        if self._db is None:
            await self.connect()

        return await self.metrics.count_documents({"page_id": page_id})

    # === Post Operations ===

    async def upsert_post(self, post_data: Dict[str, Any]) -> bool:
        """
        Insert or update a post.

        Args:
            post_data: Post data dictionary.

        Returns:
            True if successful.
        """
        if self._db is None:
            await self.connect()

        post_id = post_data.get("post_id")
        if not post_id:
            logger.error("Cannot upsert post without post_id")
            return False

        post_data["recorded_at"] = datetime.utcnow()

        try:
            await self.posts.update_one(
                {"post_id": post_id},
                {"$set": post_data},
                upsert=True,
            )
            logger.debug(f"Upserted post: {post_id}")
            return True
        except Exception as e:
            logger.error(f"Error upserting post {post_id}: {e}")
            raise

    async def insert_posts_bulk(self, posts_list: List[Dict[str, Any]]) -> int:
        """
        Insert multiple posts efficiently.

        Args:
            posts_list: List of post data dictionaries.

        Returns:
            Number of posts inserted.
        """
        if self._db is None:
            await self.connect()

        if not posts_list:
            return 0

        now = datetime.utcnow()
        for post in posts_list:
            post["recorded_at"] = now

        try:
            result = await self.posts.insert_many(posts_list, ordered=False)
            logger.debug(f"Inserted {len(result.inserted_ids)} posts")
            return len(result.inserted_ids)
        except Exception as e:
            logger.error(f"Error bulk inserting posts: {e}")
            raise

    async def get_post_by_id(self, post_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a post by post_id.

        Args:
            post_id: The Facebook post ID.

        Returns:
            Post document or None.
        """
        if self._db is None:
            await self.connect()

        return await self.posts.find_one({"post_id": post_id})

    async def get_posts_by_page(
        self,
        page_id: str,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """
        Get posts for a page.

        Args:
            page_id: The page ID.
            limit: Maximum number of posts to return.

        Returns:
            List of post documents, newest first.
        """
        if self._db is None:
            await self.connect()

        cursor = self.posts.find(
            {"page_id": page_id},
            sort=[("recorded_at", DESCENDING)],
            limit=limit,
        )
        return await cursor.to_list(length=None)

    async def get_posts_in_range(
        self,
        page_id: str,
        start_date: datetime,
        end_date: datetime,
    ) -> List[Dict[str, Any]]:
        """
        Get posts within a date range.

        Args:
            page_id: The page ID.
            start_date: Start of range.
            end_date: End of range.

        Returns:
            List of post documents.
        """
        if self._db is None:
            await self.connect()

        cursor = self.posts.find(
            {
                "page_id": page_id,
                "created_at_timestamp": {
                    "$gte": int(start_date.timestamp()),
                    "$lte": int(end_date.timestamp()),
                },
            },
            sort=[("created_at_timestamp", DESCENDING)],
        )
        return await cursor.to_list(length=None)

    async def get_posts_count(self, page_id: str) -> int:
        """
        Get total number of posts for a page.

        Args:
            page_id: The page ID.

        Returns:
            Count of posts.
        """
        if self._db is None:
            await self.connect()

        return await self.posts.count_documents({"page_id": page_id})

    async def close(self):
        """Close MongoDB connection."""
        if self._client:
            self._client.close()
            logger.debug("MongoDB connection closed")


async def create_page_storage(
    uri: Optional[str] = None,
    database: str = "sm_auto",
) -> FacebookPageStorage:
    """
    Create and connect a FacebookPageStorage instance.

    Args:
        uri: MongoDB URI.
        database: Database name.

    Returns:
        Connected FacebookPageStorage instance.
    """
    storage = FacebookPageStorage(uri=uri, database=database)
    await storage.connect()
    return storage
