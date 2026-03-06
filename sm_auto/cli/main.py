"""
SM-Auto Framework CLI.

Command-line interface for the SM-Auto web automation framework.
"""

import asyncio
import sys
from pathlib import Path
from typing import Optional

import click
from click import Context

from sm_auto import __version__
from sm_auto.utils.logger import get_logger, setup_logger
from sm_auto.utils.config import load_config, get_settings, Settings
from sm_auto.core.browser.profile_manager import ProfileManager

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
@click.version_option(version=__version__, prog_name="sm-auto")
@click.option(
    "--config",
    "-c",
    type=click.Path(exists=True),
    help="Path to configuration file",
)
@click.option(
    "--verbose",
    "-v",
    is_flag=True,
    help="Enable verbose output (DEBUG level)",
)
@click.option(
    "--log-level",
    type=click.Choice(["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"], case_sensitive=False),
    help="Set logging level",
)
@click.pass_context
def cli(ctx: Context, config: Optional[str], verbose: bool, log_level: Optional[str]) -> None:
    """
    SM-Auto: Universal Web Automation Framework

    A flexible automation framework built on nodriver for scraping
    Facebook, Instagram, TikTok, and other platforms.
    """
    # Load configuration (will also load .env file)
    settings = load_config(Path(config) if config else None)

    # Determine log level priority: CLI arg > verbose flag > config
    if verbose:
        effective_level = "DEBUG"
    elif log_level:
        effective_level = log_level.upper()
    else:
        effective_level = settings.logging.level

    # Set up logging
    import logging
    setup_logger("sm_auto", level=getattr(logging, effective_level))

    # Store in context
    ctx.ensure_object(dict)
    ctx.obj["settings"] = settings
    ctx.obj["verbose"] = verbose
    ctx.obj["log_level"] = effective_level


# Import CLI commands
from sm_auto.cli.profile_commands import profile
from sm_auto.cli.run_commands import run

cli.add_command(profile)
cli.add_command(run)


@cli.command()
@click.option("--platform", "-p", "platform_name", type=click.Choice(["facebook", "instagram", "tiktok"]))
def list_platforms(platform_name: Optional[str]) -> None:
    """List supported platforms and their capabilities."""
    platforms = {
        "facebook": {
            "name": "Facebook",
            "features": ["Marketplace search", "Feed scraping", "Group automation"],
            "status": "stable",
        },
        "instagram": {
            "name": "Instagram",
            "features": ["Profile scraping", "Hashtag search", "Reels extraction"],
            "status": "planned",
        },
        "tiktok": {
            "name": "TikTok",
            "features": ["Video scraping", "Hashtag search", "User profiles"],
            "status": "planned",
        },
    }

    click.echo("\n=== SM-Auto Supported Platforms ===\n")

    if platform_name:
        p = platforms.get(platform_name)
        if p:
            click.echo(f"Platform: {p['name']}")
            click.echo(f"Status: {p['status']}")
            click.echo("Features:")
            for feature in p["features"]:
                click.echo(f"  - {feature}")
        else:
            click.echo(f"Platform not found: {platform_name}")
    else:
        for name, info in platforms.items():
            status_icon = "✓" if info["status"] == "stable" else "○"
            click.echo(f"  {status_icon} {name}: {info['name']} ({info['status']})")

    click.echo()


@cli.command()
@click.option("--profile", "-P", help="Profile name to use")
@click.option("--platform", "-p", "platform_name", default="facebook", type=click.Choice(["facebook", "instagram", "tiktok"]))
@click.option("--user-data-dir", type=click.Path(), help="Chrome user data directory")
def auth(profile: Optional[str], platform_name: str, user_data_dir: Optional[str]) -> None:
    """
    Interactive authentication for a platform.

    Launches browser for manual login and saves session to profile.
    """
    from sm_auto.core.browser.profile_manager import ProfileManager
    from sm_auto.core.browser.driver_factory import DriverFactory
    from sm_auto.core.browser.session_manager import SessionManager

    async def auth_flow():
        click.echo("\n=== SM-Auto Authentication ===\n")

        # Get profile
        profile_mgr = get_profile_manager_with_config(user_data_dir)

        if profile:
            profiles = profile_mgr.discover_profiles_sync()
            profile_obj = next(
                (p for p in profiles if p.name.lower() == profile.lower()
                 or (p.display_name or "").lower() == profile.lower()),
                None,
            )
            if not profile_obj:
                click.echo(f"Profile not found: {profile}")
                click.echo("Available profiles:")
                for p in profiles:
                    click.echo(f"  - {p.display_name or p.name} (internal name: {p.name})")
                return
        else:
            profile_obj = await profile_mgr.select_profile_interactive()

        click.echo(f"Using profile: {profile_obj.name}")

        # Verify profile
        await profile_mgr.verify_profile(profile_obj)
        click.echo(f"Using profile path: {profile_obj.path}")

        # Launch browser
        driver_factory = DriverFactory()
        browser = await driver_factory.create(
            profile_path=profile_obj.path,
            headless=False,
        )

        # Navigate to login page
        tab = await browser.get("https://www.facebook.com/login/")

        click.echo("\nBrowser launched. Please log in manually.")
        click.echo("After logging in, close the browser to save the session.")
        click.echo("Press Ctrl+C to cancel.\n")

        # Wait for user to log in and close browser
        try:
            while True:
                await asyncio.sleep(1)
        except KeyboardInterrupt:
            click.echo("\nCancelled.")
        finally:
            await browser.stop()

        click.echo("\nSession saved. You can now use this profile for automation.")

    asyncio.run(auth_flow())


def main() -> None:
    """Main entry point."""
    cli(obj={})


if __name__ == "__main__":
    main()
