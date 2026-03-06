"""
SM-Auto Run CLI Commands.

Commands for executing automation tasks on various platforms.
"""

import asyncio
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from datetime import datetime
from typing import Optional

import click

from sm_auto.utils.logger import get_logger
from sm_auto.utils.config import get_settings
from sm_auto.core.browser.profile_manager import ProfileManager
from sm_auto.core.browser.driver_factory import DriverFactory
from sm_auto.core.browser.session_manager import SessionManager
from sm_auto.core.network.cdp_interceptor import CDPInterceptor
from sm_auto.core.network.capture_service import CaptureService
from sm_auto.platforms.facebook.marketplace.automation import (
    FacebookMarketplacePlatform,
    FacebookMarketplaceAutomation,
)

logger = get_logger(__name__)


def get_profile_manager_with_config(user_data_dir: Optional[str] = None) -> ProfileManager:
    """
    Get a ProfileManager instance, using config value as default for user_data_dir.
    """
    settings = get_settings()
    
    if user_data_dir:
        return ProfileManager(user_data_dir=Path(user_data_dir))
    elif settings.profiles.chrome_user_data_dir:
        return ProfileManager(user_data_dir=Path(settings.profiles.chrome_user_data_dir))
    else:
        return ProfileManager()


@click.group()
def run() -> None:
    """Run automation tasks."""
    pass


def _sanitize_filename(text: str) -> str:
    """
    Sanitize a string for use in a filename.
    
    Removes or replaces special characters that are not safe for filenames.
    
    Args:
        text: The input string to sanitize.
        
    Returns:
        A sanitized string safe for use in filenames.
    """
    # Replace spaces with underscores
    sanitized = text.replace(" ", "_")
    # Remove any character that is not alphanumeric, underscore, or hyphen
    sanitized = re.sub(r'[^\w\-]', '', sanitized)
    # Limit length to avoid overly long filenames
    return sanitized[:50]


@run.command("facebook-marketplace")
@click.option("--query", "-q", required=True, help="Search query")
@click.option("--profile", "-p", help="Profile name to use")
@click.option("--user-data-dir", type=click.Path(), help="Chrome user data directory")
@click.option("--output", "-o", type=click.Path(), help="Output file path (overrides storage config)")
@click.option("--scrolls", "-s", default=10, help="Maximum scroll iterations")
@click.option("--headless", is_flag=True, help="Run in headless mode")
@click.option(
    "--storage",
    type=click.Choice(["json", "mongodb", "both"], case_sensitive=False),
    help="Storage backend: json, mongodb, or both (overrides config)"
)
@click.option(
    "--log-level",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"], case_sensitive=False),
    help="Override logging level for this command"
)
@click.option(
    "--save-raw",
    is_flag=True,
    help="Enable saving raw GraphQL responses to JSONL"
)
@click.option(
    "--raw-output",
    type=click.Path(),
    help="Custom path for JSONL file (default: ./output/facebook_marketplace_raw_{query}_{timestamp}.jsonl)"
)
def facebook_marketplace(
    query: str,
    profile: Optional[str],
    user_data_dir: Optional[str],
    output: Optional[str],
    scrolls: int,
    headless: bool,
    storage: Optional[str],
    log_level: Optional[str],
    save_raw: bool = False,
    raw_output: Optional[str] = None,
) -> None:
    """
    Search Facebook Marketplace and extract listings.

    Examples:
        sm-auto run facebook-marketplace -q "iphone" -p "Personal" -o listings.json
        sm-auto run facebook-marketplace -q "laptop" --storage mongodb
        sm-auto run facebook-marketplace -q "car" --storage both --log-level INFO
    """

    async def run_automation():
        # Override log level if specified
        if log_level:
            import logging
            logging.getLogger("sm_auto").setLevel(getattr(logging, log_level))
        
        # Get settings
        settings = get_settings()
        
        click.echo(f"\n=== Facebook Marketplace Search ===")
        click.echo(f"Query: {query}")
        click.echo(f"Profile: {profile or 'default'}")
        click.echo()

        # Initialize storage backends
        from sm_auto.utils.storage import create_storage_backends
        storage_format = storage or settings.storage.default_format
        logger.info(f"Storage format: {storage_format}")
        logger.info(f"MongoDB enabled in config: {settings.storage.mongodb.enabled}")
        storage_manager = create_storage_backends(
            format_type=storage_format,
            json_enabled=settings.storage.json_config.enabled,
            json_output_dir=settings.storage.json_config.output_dir,
            json_filename_template=settings.storage.json_config.filename_template,
            mongodb_enabled=settings.storage.mongodb.enabled,
            mongodb_database=settings.storage.mongodb.database,
            mongodb_collection=settings.storage.mongodb.collection,
        )
        logger.info(f"Storage backends initialized: {storage_manager.has_backends}")

        # Get profile
        profile_mgr = get_profile_manager_with_config(user_data_dir)
        profiles = await profile_mgr.discover_profiles()

        if not profiles:
            click.echo("Error: No Chrome profiles found.", err=True)
            return

        # Select profile
        if profile:
            selected = next(
                (p for p in profiles if p.name.lower() == profile.lower()
                 or (p.display_name or "").lower() == profile.lower()),
                None,
            )
            if not selected:
                click.echo(f"Error: Profile not found: {profile}", err=True)
                return
        else:
            selected = next((p for p in profiles if p.is_default), profiles[0])

        click.echo(f"Using profile: {selected.name}")
        await profile_mgr.verify_profile(selected)

        # Initialize session manager
        session_mgr = SessionManager()

        try:
            click.echo("Launching browser...")
            await session_mgr.start(profile_path=selected.path, headless=headless)

            click.echo("Initializing Facebook Marketplace...")
            platform = FacebookMarketplacePlatform(session_mgr)
            await platform.initialize()

            if not await platform.is_logged_in():
                click.echo("\nWarning: Not logged in to Facebook.", err=True)
                return

            click.echo("Logged in successfully!")

            # Set up network capture
            capture_queue = asyncio.Queue()
            interceptor = CDPInterceptor(session_mgr.tab, capture_queue, url_filters=["graphql", "api"])
            capture_service = CaptureService()

            await interceptor.start()
            await capture_service.start(interceptor)

            automation = platform.get_automation()
            automation.capture_service = capture_service
            await automation.start_capture()

            click.echo(f"Searching for '{query}'...")
            result = await automation.search(query=query, max_scroll_count=scrolls)

            await automation.stop_capture()
            await capture_service.stop()
            await interceptor.stop()

            # Save results
            listings = result.listings
            click.echo(f"\n=== Results ===")
            click.echo(f"Found {len(listings)} listings")

            # Save raw responses if requested
            if save_raw:
                try:
                    if raw_output:
                        raw_filepath = raw_output
                    else:
                        # Generate default output path
                        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                        sanitized_query = _sanitize_filename(query)
                        raw_filepath = f"./output/facebook_marketplace_raw_{sanitized_query}_{timestamp}.jsonl"
                    
                    # Create output directory if it doesn't exist
                    output_dir = os.path.dirname(raw_filepath)
                    if output_dir and not os.path.exists(output_dir):
                        os.makedirs(output_dir, exist_ok=True)
                        logger.info(f"Created output directory: {output_dir}")
                    
                    # Save raw responses
                    success = automation.save_raw_responses(raw_filepath)
                    if success:
                        click.echo(f"Raw responses saved to: {raw_filepath}")
                    else:
                        click.echo("Warning: No raw responses were captured", err=True)
                except Exception as e:
                    logger.error(f"Failed to save raw responses: {e}")
                    click.echo(f"Error saving raw responses: {e}", err=True)

            if output:
                # CLI output path overrides config
                from sm_auto.utils.storage.json_storage import JSONFileStorage
                json_storage = JSONFileStorage(
                    output_dir=Path(output).parent,
                    filename_template=Path(output).name,
                )
                await json_storage.save(listings, metadata={
                    "platform": "facebook_marketplace",
                    "query": query,
                })
                click.echo(f"Results saved to: {output}")
            elif storage_manager.has_backends:
                logger.info(f"Saving {len(listings)} listings via storage manager...")
                try:
                    results = await storage_manager.save(listings, metadata={
                        "platform": "facebook_marketplace",
                        "query": query,
                        "session_id": str(datetime.now().timestamp()),
                    })
                    logger.info(f"Save completed. Results: {results}")
                    for result_path in results:
                        click.echo(f"Results saved to: {result_path}")
                except Exception as e:
                    logger.error(f"Failed to save to storage: {e}")
                    click.echo(f"Error saving data: {e}", err=True)
            else:
                # Console output only
                for i, listing in enumerate(listings[:10], 1):
                    click.echo(f"{i}. {listing.title} - {listing.price or 'N/A'}")

            click.echo()

        except KeyboardInterrupt:
            click.echo("\nInterrupted by user.")
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            logger.exception("Automation failed")
        finally:
            await storage_manager.close()
            await session_mgr.stop()
            click.echo("Done.")

    asyncio.run(run_automation())


@run.command("test")
@click.option("--profile", "-p", help="Profile name to use")
@click.option("--user-data-dir", type=click.Path(), help="Chrome user data directory")
def test_automation(profile: Optional[str], user_data_dir: Optional[str]) -> None:
    """
    Test automation with a simple page load.

    Useful for verifying profile and browser setup.
    """

    async def run_test():
        click.echo("\n=== SM-Auto Test ===\n")

        # Get profile
        profile_mgr = get_profile_manager_with_config(user_data_dir)
        profiles = profile_mgr.discover_profiles_sync()

        if not profiles:
            click.echo("Error: No Chrome profiles found.", err=True)
            return

        if profile:
            selected = next(
                (p for p in profiles if p.name.lower() == profile.lower()
                 or (p.display_name or "").lower() == profile.lower()),
                None,
            )
            if not selected:
                click.echo(f"Error: Profile not found: {profile}", err=True)
                click.echo("Available profiles:", err=True)
                for p in profiles:
                    click.echo(f"  - {p.display_name or p.name} (internal name: {p.name})", err=True)
                return
        else:
            selected = next((p for p in profiles if p.is_default), profiles[0])

        click.echo(f"Using profile: {selected.name}")

        # Verify profile
        await profile_mgr.verify_profile(selected)
        click.echo(f"Using profile path: {selected.path}")

        # Start browser
        session_mgr = SessionManager()

        try:
            click.echo("Launching browser...")
            await session_mgr.start(
                profile_path=selected.path,
                headless=False,
            )

            # Navigate to Facebook
            click.echo("Navigating to Facebook...")
            await session_mgr.navigate("https://www.facebook.com/")

            # Wait for page load
            await asyncio.sleep(5)

            # Take screenshot
            if session_mgr.tab:
                screenshot_path = Path("./test_screenshot.png")
                await session_mgr.tab.save_screenshot(str(screenshot_path))
                click.echo(f"Screenshot saved to: {screenshot_path}")

            # Check login status
            if "login" in session_mgr.tab.url.lower():
                click.echo("\nNot logged in. Profile may need authentication.")
            else:
                click.echo("\nSuccessfully loaded Facebook (appears logged in).")

            click.echo("\nTest complete! Browser will close in 5 seconds...")
            await asyncio.sleep(5)

        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            logger.exception("Test failed")
        finally:
            await session_mgr.stop()
            click.echo("Done.")

    asyncio.run(run_test())
