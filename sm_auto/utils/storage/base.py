"""Base storage interface for SM-Auto framework."""

from abc import ABC, abstractmethod
from typing import List, Any
from pathlib import Path


class StorageBackend(ABC):
    """Abstract base class for storage backends."""

    @abstractmethod
    async def save(self, data: List[Any], metadata: dict = None) -> str:
        """Save data and return identifier/path."""
        pass

    @abstractmethod
    async def close(self):
        """Close any open connections."""
        pass
