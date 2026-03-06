"""
SM-Auto CLI Package.

Command-line interface for the SM-Auto web automation framework.
Provides commands for profile management, automation execution, and platform control.
"""

from sm_auto.cli.profile_commands import profile
from sm_auto.cli.run_commands import run

__all__ = ["profile", "run"]
