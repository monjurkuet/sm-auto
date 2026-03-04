#!/usr/bin/env python3
"""
Facebook Marketplace Automation Example

This example demonstrates how to use the SM-Auto framework to:
1. Load an existing Chrome profile (with saved login session)
2. Search Facebook Marketplace
3. Capture network traffic via CDP
4. Extract and export listings data

Usage:
    python -m sm_auto.examples.facebook_marketplace --query "iphone" --profile "Personal"
"""

import asyncio
import json
import argparse
from pathlib import Path
from datetime import datetime

# Add parent directory to path for imports
import sys

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from sm_auto.utils.logger import get_logger
from sm_auto.core.browser.profile_manager import ProfileManager
from sm_auto.core.browser.session_manager import SessionManager
from sm_auto.core.network.cdp_interceptor import CDPInterceptor
from sm_auto.core.network.capture_service import CaptureService
from sm_auto.platforms.facebook.marketplace.automation import (
    FacebookMarketplacePlatform,
)
from sm_auto.platforms.facebook.marketplace.models import SearchFilters

logger = get_logger(__name__)


async def run_marketplace_search(
    query: str,
    profile_name: str | None = None,
    output_path: str | None = None,
    max_scrolls: int = 10,
    headless: bool = False,
    location: str | None = None,
    min_price: float | None = None,
    max_price: float | None = None,
    condition: str | None = None,
    category: str | None = None,
):
    """
    Run Facebook Marketplace search automation.

    Args:
        query: Search query string.
        profile_name: Name of Chrome profile to use.
        output_path: Path to save results (JSON).
        max_scrolls: Maximum number of scroll iterations.
        headless: Run browser in headless mode.
        location: Location filter (e.g., 'Dhaka', 'Chittagong').
        min_price: Minimum price filter.
        max_price: Maximum price filter.
        condition: Item condition filter (new, like_new, good, fair).
        category: Category filter.
    """
    print("\n" + "=" * 60)
    print("SM-Auto Facebook Marketplace Automation")
    print("=" * 60 + "\n")

    # Build filters
    filters = SearchFilters(
        location=location,
        min_price=min_price,
        max_price=max_price,
        condition=condition,
        category=category,
    )
    
    # Log filters if any are set
    if location or min_price or max_price or condition or category:
        print("Filters applied:")
        if location:
            print(f"  - Location: {location}")
        if min_price or max_price:
            print(f"  - Price range: {min_price or '0'} - {max_price or 'unlimited'}")
        if condition:
            print(f"  - Condition: {condition}")
        if category:
            print(f"  - Category: {category}")
        print()

    # === Step 1: Get Chrome Profile ===
    print("Step 1: Discovering Chrome profiles...")
    profile_mgr = ProfileManager()
    profiles = await profile_mgr.discover_profiles()

    if not profiles:
        print("ERROR: No Chrome profiles found.")
        print("Please make sure Google Chrome is installed and has been used.")
        return

    print(f"Found {len(profiles)} profile(s)")

    # Select profile
    if profile_name:
        selected = next(
            (p for p in profiles if p.name.lower() == profile_name.lower()
             or (p.display_name or "").lower() == profile_name.lower()),
            None,
        )
        if not selected:
            print(f"ERROR: Profile '{profile_name}' not found.")
            print("Available profiles:")
            for p in profiles:
                print(f"  - {p.display_name or p.name} (internal name: {p.name})")
            return
    else:
        selected = next((p for p in profiles if p.is_default), profiles[0])

    print(f"Using profile: {selected.display_name or selected.name}")

    # === Step 2: Verify Profile ===
    print("\nStep 2: Verifying profile...")
    await profile_mgr.verify_profile(selected)
    print(f"Using profile path: {selected.path}")

    # === Step 3: Initialize Session ===
    print("\nStep 3: Launching browser...")
    session_mgr = SessionManager()
    await session_mgr.start(profile_path=selected.path, headless=headless)
    print("Browser launched successfully")

    try:
        # === Step 4: Initialize Platform ===
        print("\nStep 4: Initializing Facebook Marketplace...")
        platform = FacebookMarketplacePlatform(session_mgr)
        await platform.initialize()

        # Check login status
        if not await platform.is_logged_in():
            print("\nWARNING: Not logged in to Facebook!")
            print("Please use a profile that has an active Facebook session.")
            print("You can create one by running: sm-auto auth")
            return

        print("✓ Logged in to Facebook")

        # === Step 5: Set Up Network Capture ===
        print("\nStep 5: Setting up network interception...")
        capture_queue = asyncio.Queue()
        interceptor = CDPInterceptor(
            session_mgr.tab,
            capture_queue,
            url_filters=["graphql", "api"],
        )
        capture_service = CaptureService()

        await interceptor.start()
        await capture_service.start(interceptor)
        print("Network interception enabled")

        # === Step 6: Run Automation ===
        print(f"\nStep 6: Searching for '{query}'...")
        automation = platform.get_automation()
        automation.capture_service = capture_service
        automation.filters = filters  # Apply filters
        await automation.start_capture()

        result = await automation.search(
            query=query,
            max_scroll_count=max_scrolls,
        )

        await automation.stop_capture()
        await capture_service.stop()
        await interceptor.stop()

        # === Step 7: Output Results ===
        print("\n" + "=" * 60)
        print("RESULTS")
        print("=" * 60)
        print(f"Query: {result.query}")
        print(f"Total listings found: {len(result.listings)}")

        if output_path:
            # Save to file (NDJSON format)
            output_file = Path(output_path)
            output_file.parent.mkdir(parents=True, exist_ok=True)

            with open(output_file, "w") as f:
                for listing in result.listings:
                    f.write(json.dumps(listing.model_dump()) + "\n")

            print(f"\nResults saved to: {output_file}")
        else:
            # Print first 10 results
            print("\nTop listings:")
            for i, listing in enumerate(result.listings[:10], 1):
                print(f"\n{i}. {listing.title}")
                print(f"   Price: {listing.price or 'N/A'}")
                print(f"   Location: {listing.location or 'N/A'}")
                print(f"   Seller: {listing.seller_name or 'N/A'}")
                print(f"   URL: {listing.url}")

            if len(result.listings) > 10:
                print(f"\n... and {len(result.listings) - 10} more listings")

        print("\n" + "=" * 60)

    except KeyboardInterrupt:
        print("\nInterrupted by user")
    except Exception as e:
        print(f"\nERROR: {e}")
        logger.exception("Automation failed")
    finally:
        # === Step 8: Cleanup ===
        print("\nStep 8: Closing browser...")
        await session_mgr.stop()
        print("Done!")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Facebook Marketplace Automation Example"
    )
    parser.add_argument(
        "-q", "--query",
        type=str,
        default="iphone",
        help="Search query (default: iphone)"
    )
    parser.add_argument(
        "-p", "--profile",
        type=str,
        default=None,
        help="Chrome profile name to use"
    )
    parser.add_argument(
        "-o", "--output",
        type=str,
        default=None,
        help="Output file path (JSON)"
    )
    parser.add_argument(
        "-s", "--scrolls",
        type=int,
        default=10,
        help="Maximum scroll iterations (default: 10)"
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run browser in headless mode"
    )
    parser.add_argument(
        "-l", "--location",
        type=str,
        default=None,
        help="Location filter (e.g., 'Dhaka', 'Chittagong')"
    )
    parser.add_argument(
        "--min-price",
        type=float,
        default=None,
        help="Minimum price filter"
    )
    parser.add_argument(
        "--max-price",
        type=float,
        default=None,
        help="Maximum price filter"
    )
    parser.add_argument(
        "--condition",
        type=str,
        default=None,
        choices=["new", "like_new", "good", "fair"],
        help="Item condition filter"
    )
    parser.add_argument(
        "--category",
        type=str,
        default=None,
        help="Category filter"
    )

    args = parser.parse_args()

    asyncio.run(
        run_marketplace_search(
            query=args.query,
            profile_name=args.profile,
            output_path=args.output,
            max_scrolls=args.scrolls,
            headless=args.headless,
            location=args.location,
            min_price=args.min_price,
            max_price=args.max_price,
            condition=args.condition,
            category=args.category,
        )
    )


if __name__ == "__main__":
    main()
