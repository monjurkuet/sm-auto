"""
SM-Auto Facebook Marketplace Package.

Provides automation functionality for Facebook Marketplace.
Includes web scraping, search automation, and data extraction.

Classes:
    FacebookMarketplaceAutomation: Main automation handler
    FacebookMarketplacePlatform: Platform interface
    FacebookMarketplaceConfig: Platform configuration
    MarketplaceParser: Data parser for marketplace listings
"""

from sm_auto.platforms.facebook.marketplace.automation import (
    FacebookMarketplaceAutomation,
    FacebookMarketplacePlatform,
    FacebookMarketplaceConfig,
)
from sm_auto.platforms.facebook.marketplace.parser import MarketplaceParser
from sm_auto.platforms.facebook.marketplace.models import (
    MarketplaceListing,
    MarketplaceSearchResult,
    SearchFilters,
)

__all__ = [
    "FacebookMarketplaceAutomation",
    "FacebookMarketplacePlatform",
    "FacebookMarketplaceConfig",
    "MarketplaceParser",
    "MarketplaceListing",
    "MarketplaceSearchResult",
    "SearchFilters",
]
