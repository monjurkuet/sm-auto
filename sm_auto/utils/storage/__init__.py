"""Storage utilities for SM-Auto framework."""

from pathlib import Path
from typing import List, Optional, Any

from sm_auto.utils.storage.base import StorageBackend
from sm_auto.utils.storage.json_storage import JSONFileStorage
from sm_auto.utils.storage.mongodb_storage import MongoDBStorage
from sm_auto.utils.logger import get_logger

logger = get_logger(__name__)


class StorageManager:
    """Manages multiple storage backends."""

    def __init__(self):
        self._backends: List[StorageBackend] = []

    def add_backend(self, backend: StorageBackend):
        """Add a storage backend."""
        self._backends.append(backend)

    @property
    def has_backends(self) -> bool:
        """Check if any backends are configured."""
        return len(self._backends) > 0

    async def save(self, data: List[Any], metadata: dict = None):
        """Save data to all configured backends."""
        results = []
        for backend in self._backends:
            try:
                result = await backend.save(data, metadata)
                results.append(result)
            except Exception as e:
                logger.exception(f"Storage backend {type(backend).__name__} failed: {e}")
                raise
        return results

    async def close(self):
        """Close all backends."""
        for backend in self._backends:
            try:
                await backend.close()
            except Exception as e:
                logger.error(f"Error closing backend: {e}")


def create_storage_backends(
    format_type: str,
    json_enabled: bool = True,
    json_output_dir: str = "./output",
    json_filename_template: str = "{platform}_{query}_{timestamp}.json",
    mongodb_enabled: bool = False,
    mongodb_database: str = "sm_auto",
    mongodb_collection: str = "facebook_marketplace",
    mongodb_uri: Optional[str] = None,
) -> StorageManager:
    """Factory function to create storage backends based on configuration."""
    
    manager = StorageManager()

    if format_type in ("json", "both") and json_enabled:
        manager.add_backend(
            JSONFileStorage(
                output_dir=Path(json_output_dir),
                filename_template=json_filename_template,
            )
        )

    if format_type in ("mongodb", "both") and mongodb_enabled:
        import os
        effective_uri = mongodb_uri or os.getenv("MONGODB_URI")
        logger.info(f"MongoDB URI available: {bool(effective_uri)}")
        try:
            backend = MongoDBStorage(
                uri=effective_uri,
                database=mongodb_database,
                collection=mongodb_collection,
            )
            manager.add_backend(backend)
            logger.info("MongoDB storage backend added successfully")
        except ValueError as e:
            logger.error(f"MongoDB storage not available: {e}")
            raise

    logger.info(f"Storage manager created with {len(manager._backends)} backend(s)")
    return manager
