"""JSON file storage backend."""

import json
import asyncio
from datetime import datetime
from pathlib import Path
from typing import List, Any

from sm_auto.utils.storage.base import StorageBackend
from sm_auto.utils.logger import get_logger

logger = get_logger(__name__)


class JSONFileStorage(StorageBackend):
    """Store data in NDJSON format files."""

    def __init__(
        self,
        output_dir: Path,
        filename_template: str = "{platform}_{query}_{timestamp}.json",
    ):
        self.output_dir = Path(output_dir)
        self.filename_template = filename_template
        self.output_dir.mkdir(parents=True, exist_ok=True)

    async def save(self, data: List[Any], metadata: dict = None) -> str:
        """Save data to NDJSON file."""
        metadata = metadata or {}
        filename = self._generate_filename(metadata)
        filepath = self.output_dir / filename

        def _write():
            with open(filepath, "w") as f:
                for item in data:
                    if hasattr(item, "model_dump"):
                        f.write(json.dumps(item.model_dump(mode="json")) + "\n")
                    else:
                        f.write(json.dumps(item) + "\n")

        await asyncio.to_thread(_write)
        logger.info(f"Saved {len(data)} items to {filepath}")
        return str(filepath)

    def _generate_filename(self, metadata: dict) -> str:
        """Generate filename from template."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = self.filename_template.format(
            platform=metadata.get("platform", "unknown"),
            query=metadata.get("query", "data").replace(" ", "_"),
            timestamp=timestamp,
        )
        return filename

    async def close(self):
        """No-op for file storage."""
        pass
