"""
Pytest configuration and fixtures for SM-Auto tests.
"""

import pytest
from pathlib import Path

# Add project root to path for imports
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))


@pytest.fixture
def test_data_dir() -> Path:
    """Return path to test data directory."""
    return Path(__file__).parent / "data"


@pytest.fixture
def project_root() -> Path:
    """Return path to project root."""
    return Path(__file__).parent.parent


@pytest.fixture
def mock_settings():
    """Create mock settings for testing delays."""
    from unittest.mock import MagicMock
    
    settings = MagicMock()
    settings.delays.micro_delay_min = 0.01
    settings.delays.micro_delay_max = 0.02
    settings.delays.action_delay_min = 0.05
    settings.delays.action_delay_max = 0.1
    settings.delays.task_delay_min = 0.1
    settings.delays.task_delay_max = 0.2
    settings.delays.page_delay_min = 0.05
    settings.delays.page_delay_max = 0.1
    settings.delays.reading_pause_min = 0.1
    settings.delays.reading_pause_max = 0.2
    settings.delays.wpm = 120
    
    return settings
