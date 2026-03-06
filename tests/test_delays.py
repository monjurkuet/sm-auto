"""
Tests for delay utilities.
"""

import pytest
import asyncio
from unittest.mock import patch

from sm_auto.utils import delays


class TestDelays:
    """Test delay utility functions."""

    @pytest.mark.asyncio
    async def test_micro_delay_uses_cached_settings(self, mock_settings):
        """Test that micro_delay uses cached settings."""
        with patch.object(delays, '_settings_cache', mock_settings):
            start = asyncio.get_event_loop().time()
            await delays.micro_delay()
            elapsed = asyncio.get_event_loop().time() - start
            
            # Should complete within expected range
            assert 0.01 <= elapsed <= 0.03

    @pytest.mark.asyncio
    async def test_action_delay_uses_cached_settings(self, mock_settings):
        """Test that action_delay uses cached settings."""
        with patch.object(delays, '_settings_cache', mock_settings):
            start = asyncio.get_event_loop().time()
            await delays.action_delay()
            elapsed = asyncio.get_event_loop().time() - start
            
            assert 0.05 <= elapsed <= 0.12

    @pytest.mark.asyncio
    async def test_task_delay_uses_cached_settings(self, mock_settings):
        """Test that task_delay uses cached settings."""
        with patch.object(delays, '_settings_cache', mock_settings):
            start = asyncio.get_event_loop().time()
            await delays.task_delay()
            elapsed = asyncio.get_event_loop().time() - start
            
            assert 0.1 <= elapsed <= 0.22

    @pytest.mark.asyncio
    async def test_page_delay_uses_cached_settings(self, mock_settings):
        """Test that page_delay uses cached settings."""
        with patch.object(delays, '_settings_cache', mock_settings):
            start = asyncio.get_event_loop().time()
            await delays.page_delay()
            elapsed = asyncio.get_event_loop().time() - start
            
            assert 0.05 <= elapsed <= 0.12

    @pytest.mark.asyncio
    async def test_reading_pause_uses_cached_settings(self, mock_settings):
        """Test that reading_pause uses cached settings."""
        with patch.object(delays, '_settings_cache', mock_settings):
            start = asyncio.get_event_loop().time()
            await delays.reading_pause()
            elapsed = asyncio.get_event_loop().time() - start
            
            assert 0.1 <= elapsed <= 0.22

    def test_clear_settings_cache(self):
        """Test that clear_settings_cache resets the cache."""
        # Set a mock cache
        delays._settings_cache = "mock_settings"
        
        # Clear it
        delays.clear_settings_cache()
        
        # Verify it's cleared
        assert delays._settings_cache is None

    @pytest.mark.asyncio
    async def test_get_cached_settings_lazy_load(self):
        """Test that settings are loaded lazily and cached."""
        # Clear cache first
        delays.clear_settings_cache()
        
        with patch('sm_auto.utils.config.get_settings') as mock_get_settings:
            mock_settings = type('obj', (object,), {
                'delays': type('obj', (object,), {'micro_delay_min': 0.01, 'micro_delay_max': 0.02})()
            })()
            mock_get_settings.return_value = mock_settings
            
            # First call should load settings
            settings1 = delays._get_cached_settings()
            assert mock_get_settings.called
            
            # Reset mock
            mock_get_settings.reset_mock()
            
            # Second call should use cache
            settings2 = delays._get_cached_settings()
            assert not mock_get_settings.called
            assert settings1 is settings2
