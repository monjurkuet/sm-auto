"""
SM-Auto Profile Management CLI Commands.

Commands for discovering, verifying, and managing Chrome profiles.
"""

import asyncio
import json
from pathlib import Path

import click

from sm_auto.utils.logger import get_logger
from sm_auto.core.browser.profile_manager import ProfileManager, ChromeUserDataDir
from sm_auto.core.browser.driver_factory import DriverFactory
from sm_auto.core.exceptions import ProfileNotFoundError, ProfileLockedError

logger = get_logger(__name__)


@click.group()
def profile():
    """Manage Chrome profiles for automation."""
    pass


def get_profile_manager_with_config(user_data_dir: str = None) -> ProfileManager:
    """
    Get a ProfileManager instance, using config value as default for user_data_dir.
    
    Args:
        user_data_dir: Explicit user data dir from CLI option.
        
    Returns:
        ProfileManager instance.
    """
    from sm_auto.utils.config import get_settings
    
    settings = get_settings()
    
    # Use CLI option if provided, otherwise fall back to config
    if user_data_dir:
        return ProfileManager(user_data_dir=Path(user_data_dir))
    elif settings.profiles.chrome_user_data_dir:
        return ProfileManager(user_data_dir=Path(settings.profiles.chrome_user_data_dir))
    else:
        return ProfileManager()


@profile.command("list")
@click.option("--verbose", "-v", is_flag=True, help="Show detailed profile information")
@click.option("--user-data-dir", type=click.Path(), help="Chrome user data directory (overrides config)")
def list_profiles(verbose, user_data_dir):
    """List all available Chrome profiles."""

    manager = get_profile_manager_with_config(user_data_dir)

    try:
        profiles = manager.discover_profiles()
    except ProfileNotFoundError as e:
        click.echo(f"Error: {e}", err=True)
        return

    if not profiles:
        click.echo("No Chrome profiles found.")
        return

    click.echo(f"\n=== Found {len(profiles)} Chrome Profile(s) ===\n")

    for i, profile in enumerate(profiles, 1):
        default_marker = " [DEFAULT]" if profile.is_default else ""
        click.echo(f"{i}. {profile.display_name or profile.name}{default_marker}")
        click.echo(f"   Path: {profile.path}")

        if verbose:
            if profile.email:
                click.echo(f"   Email: {profile.email}")
            if profile.last_used:
                click.echo(f"   Last Used: {profile.last_used}")

        click.echo()


@profile.command("detect")
@click.option("--verbose", "-v", is_flag=True, help="Show detailed profile information")
@click.option("--path", type=click.Path(), help="Scan specific Chrome user data directory")
@click.option("--config", "use_config", is_flag=True, help="Scan the directory from config.yaml")
@click.option("--json", "output_json", is_flag=True, help="Output as JSON for config")
def detect_profiles(verbose, path, use_config, output_json):
    """
    Auto-detect and list all Chrome user data directories with their profiles.

    This helps identify available Chrome profiles for configuration.
    """
    if path:
        # Scan specific directory
        user_data_path = Path(path)
        if not user_data_path.exists():
            click.echo(f"Error: Directory not found: {path}", err=True)
            return

        manager = ProfileManager(user_data_dir=user_data_path)
        try:
            profiles = manager.discover_profiles()
        except ProfileNotFoundError as e:
            click.echo(f"Error: {e}", err=True)
            return

        user_data_dir = ChromeUserDataDir(
            path=user_data_path,
            is_default=False,
            browser_name="Chrome",
            profiles=profiles,
        )
        user_data_dirs = [user_data_dir]
    elif use_config:
        # Use config-defined directory
        from sm_auto.utils.config import get_settings
        settings = get_settings()
        if not settings.profiles.chrome_user_data_dir:
            click.echo("Error: No chrome_user_data_dir configured in config.yaml", err=True)
            return
        
        user_data_path = Path(settings.profiles.chrome_user_data_dir)
        if not user_data_path.exists():
            click.echo(f"Error: Config directory not found: {user_data_path}", err=True)
            return
            
        manager = ProfileManager(user_data_dir=user_data_path)
        try:
            profiles = manager.discover_profiles()
        except ProfileNotFoundError as e:
            click.echo(f"Error: {e}", err=True)
            return
            
        user_data_dir = ChromeUserDataDir(
            path=user_data_path,
            is_default=True,
            browser_name="Chrome (from config)",
            profiles=profiles,
        )
        user_data_dirs = [user_data_dir]
    else:
        # Scan all common locations
        user_data_dirs = ProfileManager.detect_all_chrome_dirs()

    if output_json:
        # Output as JSON
        output = []
        for udd in user_data_dirs:
            output.append({
                "path": str(udd.path),
                "browser": udd.browser_name,
                "is_default": udd.is_default,
                "profiles": [
                    {
                        "name": p.name,
                        "display_name": p.display_name,
                        "path": str(p.path),
                        "email": p.email,
                        "is_default": p.is_default,
                    }
                    for p in udd.profiles
                ],
            })
        click.echo(json.dumps(output, indent=2))
        return

    # Human-readable output
    if not user_data_dirs:
        click.echo("No Chrome user data directories found.")
        return

    click.echo("=== Chrome User Data Directories Found ===\n")

    for i, udd in enumerate(user_data_dirs, 1):
        default_marker = " [DEFAULT]" if udd.is_default else ""
        click.echo(f"{i}. {udd.browser_name}: {udd.path}{default_marker}")

        if udd.profiles:
            click.echo("   Profiles:")
            for profile in udd.profiles:
                default_p = " [DEFAULT]" if profile.is_default else ""
                email_p = f" ({profile.email})" if profile.email else ""
                click.echo(f"   - {profile.display_name or profile.name}{email_p}{default_p}")

                if verbose:
                    click.echo(f"     Path: {profile.path}")
                    if profile.last_used:
                        click.echo(f"     Last Used: {profile.last_used}")
        else:
            click.echo("   No profiles found")

        click.echo()

    # Show config suggestion
    click.echo("=== Use in config.yaml ===")
    click.echo("profiles:")
    if user_data_dirs:
        click.echo(f'  chrome_user_data_dir: "{user_data_dirs[0].path}"')


@profile.command("verify")
@click.argument("profile_name")
@click.option("--user-data-dir", type=click.Path(), help="Chrome user data directory (overrides config)")
def verify_profile(profile_name, user_data_dir):
    """Verify a profile is valid and available."""

    manager = get_profile_manager_with_config(user_data_dir)

    try:
        profiles = manager.discover_profiles()
    except ProfileNotFoundError as e:
        click.echo(f"Error: {e}", err=True)
        return

    profile = next(
        (p for p in profiles if p.name.lower() == profile_name.lower()),
        None,
    )

    if not profile:
        click.echo(f"Profile not found: {profile_name}")
        return

    async def run():
        click.echo(f"Verifying profile: {profile.name}...")

        try:
            is_valid = await manager.verify_profile(profile)
            if is_valid:
                click.echo(f"✓ Profile '{profile.name}' is valid and available.")
            else:
                click.echo(f"✗ Profile '{profile.name}' has issues.")
        except ProfileLockedError as e:
            click.echo(f"✗ Profile is locked: {e}", err=True)
        except Exception as e:
            click.echo(f"✗ Error verifying profile: {e}", err=True)

    asyncio.run(run())


@profile.command("launch")
@click.option("--profile", "-p", help="Profile name to use (e.g., 'Default', 'Profile 1')")
@click.option("--path", type=click.Path(), help="Direct path to profile directory")
@click.option("--user-data-dir", type=click.Path(), help="Chrome user data directory (overrides config)")
@click.option("--headless/--no-headless", default=False, help="Run in headless mode")
def launch_profile(profile, path, user_data_dir, headless):
    """
    Launch browser with a profile for testing/verification.

    Examples:
        sm-auto profile launch --profile "Default"
        sm-auto profile launch --path "/path/to/profile"
        sm-auto profile launch --user-data-dir "/path/to/chrome/data" --profile "Default"
    """
    # Determine profile path
    profile_path = None

    if path:
        # Direct profile path provided
        profile_path = Path(path)
    elif profile:
        # Look up profile by name
        manager = get_profile_manager_with_config(user_data_dir)
        try:
            profiles = manager.discover_profiles()
        except ProfileNotFoundError as e:
            click.echo(f"Error: {e}", err=True)
            return

        selected = next(
            (p for p in profiles if p.name.lower() == profile.lower()
             or (p.display_name or "").lower() == profile.lower()),
            None,
        )
        if not selected:
            click.echo(f"Profile not found: {profile}", err=True)
            click.echo("Available profiles:")
            for p in profiles:
                click.echo(f"  - {p.display_name or p.name}")
            return

        profile_path = selected.path
    else:
        click.echo("Error: Either --profile or --path must be specified", err=True)
        return

    click.echo(f"\n=== Launching Browser ===")
    click.echo(f"Profile path: {profile_path}")
    click.echo(f"Headless: {headless}")
    click.echo()

    async def run():
        driver_factory = DriverFactory()

        try:
            browser = await driver_factory.create(
                profile_path=profile_path,
                headless=headless,
            )

            click.echo("Browser launched successfully!")
            click.echo("Press Ctrl+C to close...")

            # Keep browser open
            try:
                while True:
                    await asyncio.sleep(1)
            except KeyboardInterrupt:
                click.echo("\nClosing browser...")

            await browser.stop()
            click.echo("Browser closed.")

        except Exception as e:
            click.echo(f"Error launching browser: {e}", err=True)
            logger.exception("Browser launch failed")

    asyncio.run(run())


@profile.command("info")
@click.argument("profile_name")
@click.option("--user-data-dir", type=click.Path(), help="Chrome user data directory (overrides config)")
def profile_info(profile_name, user_data_dir):
    """Show detailed information about a profile."""

    manager = get_profile_manager_with_config(user_data_dir)

    try:
        profiles = manager.discover_profiles()
    except ProfileNotFoundError as e:
        click.echo(f"Error: {e}", err=True)
        return

    profile = next(
        (p for p in profiles if p.name.lower() == profile_name.lower()),
        None,
    )

    if not profile:
        click.echo(f"Profile not found: {profile_name}")
        return

    click.echo(f"\n=== Profile: {profile.name} ===\n")
    click.echo(f"Display Name: {profile.display_name or 'N/A'}")
    click.echo(f"Email: {profile.email or 'N/A'}")
    click.echo(f"Is Default: {'Yes' if profile.is_default else 'No'}")
    click.echo(f"Last Used: {profile.last_used or 'N/A'}")
    click.echo(f"Path: {profile.path}")

    # Check if profile is locked
    lock_file = profile.path / "SingletonLock"
    if lock_file.exists():
        click.echo("Status: LOCKED (Chrome may be running with this profile)")
    else:
        click.echo("Status: Available")

    click.echo()
