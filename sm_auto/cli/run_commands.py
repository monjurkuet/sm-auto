"""
SM-Auto Run CLI Commands.

Commands for executing automation tasks on various platforms.
"""

import asyncio
import json
import sys
from pathlib import Path
from datetime import datetime

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


def get_profile_manager_with_config(user_data_dir: str = None) -> ProfileManager:
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
def run():
    """Run automation tasks."""
    pass


@run.command("facebook-marketplace")
@click.option("--query", "-q", required=True, help="Search query")
@click.option("--profile", "-p", help="Profile name to use")
@click.option("--user-data-dir", type=click.Path(), help="Chrome user data directory")
@click.option("--output", "-o", type=click.Path(), help="Output file path")
@click.option("--scrolls", "-s", default=10, help="Maximum scroll iterations")
@click.option("--headless", is_flag=True, help="Run in headless mode")
def facebook_marketplace(query, profile, user_data_dir, output, scrolls, headless):
    """
    Search Facebook Marketplace and extract listings.

    Example:
        sm-auto run facebook-marketplace -q "iphone" -p "Personal" -o listings.json
    """

    async def run_automation():
        click.echo(f"\n=== Facebook Marketplace Search ===")
        click.echo(f"Query: {query}")
        click.echo(f"Profile: {profile or 'default'}")
        click.echo(f"Output: {output or 'console'}")
        click.echo()

        # Get profile
        profile_mgr = get_profile_manager_with_config(user_data_dir)
        profiles = profile_mgr.discover_profiles()

        if not profiles:
            click.echo("Error: No Chrome profiles found.", err=True)
            click.echo("Run 'sm-auto profile list' to see available profiles.", err=True)
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
        click.echo()

        # Initialize session manager
        session_mgr = SessionManager()

        try:
            # Start browser
            click.echo("Launching browser...")
            await session_mgr.start(
                profile_path=selected.path,
                headless=headless,
            )

            # Initialize platform
            click.echo("Initializing Facebook Marketplace...")
            platform = FacebookMarketplacePlatform(session_mgr)
            await platform.initialize()

            # Check if logged in
            if not await platform.is_logged_in():
                click.echo(
                    "\nWarning: Not logged in to Facebook.",
                    err=True,
                )
                click.echo(
                    "Please run 'sm-auto auth' first or use a logged-in profile.",
                    err=True,
                )
                return

            click.echo("Logged in successfully!")
            click.echo()

            # Set up network capture
            capture_queue = asyncio.Queue()
            interceptor = CDPInterceptor(
                session_mgr.tab,
                capture_queue,
                url_filters=["graphql", "api"],
            )
            capture_service = CaptureService()

            await interceptor.start()
            await capture_service.start(interceptor)

            # Create automation and attach capture service
            automation = platform.get_automation()
            automation.capture_service = capture_service
            await automation.start_capture()

            # Run search
            click.echo(f"Searching for '{query}'...")
            result = await automation.search(
                query=query,
                max_scroll_count=scrolls,
            )

            # Stop capture
            await automation.stop_capture()
            await capture_service.stop()
            await interceptor.stop()

            # Output results
            listings = result.listings
            click.echo(f"\n=== Results ===")
            click.echo(f"Found {len(listings)} listings")

            if output:
                # Write to file (NDJSON format)
                output_path = Path(output)
                output_path.parent.mkdir(parents=True, exist_ok=True)

                with open(output_path, "w") as f:
                    for listing in listings:
                        # Use mode='json' to serialize datetime to ISO format
                        f.write(json.dumps(listing.model_dump(mode='json')) + "\n")

                click.echo(f"Results saved to: {output_path}")
            else:
                # Print to console
                click.echo()
                for i, listing in enumerate(listings[:10], 1):
                    click.echo(f"{i}. {listing.title}")
                    click.echo(f"   Price: {listing.price or 'N/A'}")
                    click.echo(f"   Location: {listing.location or 'N/A'}")
                    click.echo(f"   URL: {listing.url}")
                    click.echo()

                if len(listings) > 10:
                    click.echo(f"... and {len(listings) - 10} more listings")

            click.echo()

        except KeyboardInterrupt:
            click.echo("\nInterrupted by user.")
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            logger.exception("Automation failed")
        finally:
            click.echo("Closing browser...")
            await session_mgr.stop()
            click.echo("Done.")

    asyncio.run(run_automation())


@run.command("test")
@click.option("--profile", "-p", help="Profile name to use")
@click.option("--user-data-dir", type=click.Path(), help="Chrome user data directory")
def test_automation(profile, user_data_dir):
    """
    Test automation with a simple page load.

    Useful for verifying profile and browser setup.
    """

    async def run_test():
        click.echo("\n=== SM-Auto Test ===\n")

        # Get profile
        profile_mgr = get_profile_manager_with_config(user_data_dir)
        profiles = profile_mgr.discover_profiles()

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
