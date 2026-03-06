"""
Facebook Page Module.

Provides functionality for tracking Facebook pages and their metrics.
"""

from sm_auto.platforms.facebook.page.models import (
    FacebookPage,
    FacebookPageMetric,
    PageExtractionResult,
    PageUpdateResult,
)
from sm_auto.platforms.facebook.page.extractor import (
    FacebookPageExtractor,
    extract_page_id_from_url,
    normalize_page_url,
    extract_username_from_url,
)
from sm_auto.platforms.facebook.page.storage import (
    FacebookPageStorage,
    create_page_storage,
)
from sm_auto.platforms.facebook.page.automation import (
    FacebookPageConfig,
    FacebookPagePlatform,
    FacebookPageAutomation,
    create_page_automation,
)

__all__ = [
    # Models
    "FacebookPage",
    "FacebookPageMetric",
    "PageExtractionResult",
    "PageUpdateResult",
    # Extractor
    "FacebookPageExtractor",
    "extract_page_id_from_url",
    "normalize_page_url",
    "extract_username_from_url",
    # Storage
    "FacebookPageStorage",
    "create_page_storage",
    # Automation
    "FacebookPageConfig",
    "FacebookPagePlatform",
    "FacebookPageAutomation",
    "create_page_automation",
]
