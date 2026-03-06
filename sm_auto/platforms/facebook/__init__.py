"""
SM-Auto Facebook Platform Package.

Provides platform implementations for Facebook automation.
Currently includes support for Facebook Marketplace.

Subpackages:
    marketplace: Facebook Marketplace automation
    auth: Facebook authentication utilities
"""

from sm_auto.platforms.facebook.marketplace.automation import (
    FacebookMarketplaceAutomation,
    FacebookMarketplacePlatform,
    FacebookMarketplaceConfig,
)

__all__ = [
    "FacebookMarketplaceAutomation",
    "FacebookMarketplacePlatform",
    "FacebookMarketplaceConfig",
]
