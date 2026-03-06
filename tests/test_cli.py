"""
Tests for CLI Commands.

Tests command-line interface functionality using Click's test runner.
"""

from click.testing import CliRunner
import pytest
from unittest.mock import patch, MagicMock, AsyncMock

from sm_auto.cli.main import cli
from sm_auto.cli.profile_commands import profile
from sm_auto.cli.run_commands import run


class TestMainCLI:
    """Tests for main CLI commands."""

    @pytest.fixture
    def runner(self):
        """Create a Click test runner."""
        return CliRunner()

    def test_cli_help(self, runner):
        """Test main CLI help output."""
        result = runner.invoke(cli, ["--help"])

        assert result.exit_code == 0
        assert "SM-Auto" in result.output
        assert "Universal Web Automation Framework" in result.output

    def test_cli_version(self, runner):
        """Test CLI version flag."""
        result = runner.invoke(cli, ["--version"])

        assert result.exit_code == 0
        assert "sm-auto" in result.output

    def test_list_platforms_help(self, runner):
        """Test list-platforms command help."""
        result = runner.invoke(cli, ["list-platforms", "--help"])

        assert result.exit_code == 0
        assert "List supported platforms" in result.output

    def test_list_platforms_output(self, runner):
        """Test list-platforms command output."""
        result = runner.invoke(cli, ["list-platforms"])

        assert result.exit_code == 0
        assert "facebook" in result.output
        assert "instagram" in result.output
        assert "tiktok" in result.output

    def test_list_platforms_specific(self, runner):
        """Test list-platforms with specific platform."""
        result = runner.invoke(cli, ["list-platforms", "--platform", "facebook"])

        assert result.exit_code == 0
        assert "Facebook" in result.output
        assert "Marketplace" in result.output or "Features:" in result.output

    def test_verbose_flag(self, runner):
        """Test verbose flag."""
        result = runner.invoke(cli, ["--verbose", "list-platforms"])

        # Should complete successfully
        assert result.exit_code == 0

    def test_log_level_option(self, runner):
        """Test log level option."""
        result = runner.invoke(cli, ["--log-level", "DEBUG", "list-platforms"])

        assert result.exit_code == 0


class TestProfileCommands:
    """Tests for profile CLI commands."""

    @pytest.fixture
    def runner(self):
        """Create a Click test runner."""
        return CliRunner()

    def test_profile_help(self, runner):
        """Test profile command help."""
        result = runner.invoke(cli, ["profile", "--help"])

        assert result.exit_code == 0
        assert "Manage Chrome profiles" in result.output

    def test_profile_list_help(self, runner):
        """Test profile list command help."""
        result = runner.invoke(cli, ["profile", "list", "--help"])

        assert result.exit_code == 0
        assert "List all available Chrome profiles" in result.output

    @patch("sm_auto.cli.profile_commands.ProfileManager")
    def test_profile_list_no_profiles(self, mock_manager_class, runner):
        """Test profile list when no profiles found."""
        mock_manager = MagicMock()
        mock_manager.discover_profiles = AsyncMock(return_value=[])
        mock_manager_class.return_value = mock_manager

        result = runner.invoke(cli, ["profile", "list"])

        assert result.exit_code == 0
        assert "No Chrome profiles found" in result.output

    def test_profile_detect_help(self, runner):
        """Test profile detect command help."""
        result = runner.invoke(cli, ["profile", "detect", "--help"])

        assert result.exit_code == 0
        assert "Auto-detect" in result.output

    def test_profile_verify_help(self, runner):
        """Test profile verify command help."""
        result = runner.invoke(cli, ["profile", "verify", "--help"])

        assert result.exit_code == 0
        assert "Verify a profile" in result.output

    def test_profile_launch_help(self, runner):
        """Test profile launch command help."""
        result = runner.invoke(cli, ["profile", "launch", "--help"])

        assert result.exit_code == 0
        assert "Launch browser" in result.output

    def test_profile_info_help(self, runner):
        """Test profile info command help."""
        result = runner.invoke(cli, ["profile", "info", "--help"])

        assert result.exit_code == 0
        assert "Show detailed information" in result.output


class TestRunCommands:
    """Tests for run CLI commands."""

    @pytest.fixture
    def runner(self):
        """Create a Click test runner."""
        return CliRunner()

    def test_run_help(self, runner):
        """Test run command help."""
        result = runner.invoke(cli, ["run", "--help"])

        assert result.exit_code == 0
        assert "Run automation tasks" in result.output

    def test_run_facebook_marketplace_help(self, runner):
        """Test facebook-marketplace command help."""
        result = runner.invoke(cli, ["run", "facebook-marketplace", "--help"])

        assert result.exit_code == 0
        assert "Search Facebook Marketplace" in result.output
        assert "--query" in result.output
        assert "--profile" in result.output

    def test_run_facebook_marketplace_missing_query(self, runner):
        """Test facebook-marketplace without required query."""
        result = runner.invoke(cli, ["run", "facebook-marketplace"])

        assert result.exit_code != 0
        assert "Missing option" in result.output or "required" in result.output.lower()

    def test_run_test_help(self, runner):
        """Test run test command help."""
        result = runner.invoke(cli, ["run", "test", "--help"])

        assert result.exit_code == 0
        assert "Test automation" in result.output


class TestAuthCommand:
    """Tests for auth CLI command."""

    @pytest.fixture
    def runner(self):
        """Create a Click test runner."""
        return CliRunner()

    def test_auth_help(self, runner):
        """Test auth command help."""
        result = runner.invoke(cli, ["auth", "--help"])

        assert result.exit_code == 0
        assert "Interactive authentication" in result.output
        assert "--profile" in result.output
        assert "--platform" in result.output


class TestCLINestedCommands:
    """Tests for nested CLI command structure."""

    @pytest.fixture
    def runner(self):
        """Create a Click test runner."""
        return CliRunner()

    def test_cli_has_profile_command(self, runner):
        """Test that CLI has profile command registered."""
        result = runner.invoke(cli, ["--help"])

        assert "profile" in result.output

    def test_cli_has_run_command(self, runner):
        """Test that CLI has run command registered."""
        result = runner.invoke(cli, ["--help"])

        assert "run" in result.output

    def test_profile_has_subcommands(self, runner):
        """Test that profile has subcommands."""
        result = runner.invoke(cli, ["profile", "--help"])

        assert "list" in result.output
        assert "detect" in result.output
        assert "verify" in result.output
        assert "launch" in result.output
        assert "info" in result.output

    def test_run_has_subcommands(self, runner):
        """Test that run has subcommands."""
        result = runner.invoke(cli, ["run", "--help"])

        assert "facebook-marketplace" in result.output
        assert "test" in result.output
