"""
Tests for Network Interception module.

Tests CDP interceptor and capture service functionality.
"""

import asyncio
import json
from datetime import datetime
from unittest.mock import MagicMock, AsyncMock, patch, call

import pytest

from sm_auto.core.network.cdp_interceptor import CDPInterceptor
from sm_auto.core.network.capture_service import CaptureService
from sm_auto.core.network.models import NetworkCaptureEvent, RequestEvent, ResponseEvent
from sm_auto.core.exceptions import NetworkInterceptionError


class TestCDPInterceptor:
    """Tests for CDPInterceptor class."""

    @pytest.fixture
    def mock_tab(self):
        """Create a mock browser tab."""
        tab = MagicMock()
        tab.send = AsyncMock()
        return tab

    @pytest.fixture
    def event_queue(self):
        """Create an async event queue."""
        return asyncio.Queue()

    @pytest.fixture
    def interceptor(self, mock_tab, event_queue):
        """Create a CDPInterceptor instance."""
        return CDPInterceptor(
            tab=mock_tab,
            queue=event_queue,
            url_filters=["graphql", "api"],
            ignored_mimes=["image/", "text/css"],
        )

    @pytest.mark.asyncio
    async def test_start_interception(self, interceptor, mock_tab):
        """Test starting network interception."""
        await interceptor.start()

        assert interceptor._enabled
        mock_tab.send.assert_called_once()

    @pytest.mark.asyncio
    async def test_start_already_enabled(self, interceptor, mock_tab):
        """Test starting when already enabled."""
        interceptor._enabled = True

        await interceptor.start()

        # Should not send enable command again
        mock_tab.send.assert_not_called()

    @pytest.mark.asyncio
    async def test_stop_interception(self, interceptor, mock_tab):
        """Test stopping network interception."""
        interceptor._enabled = True

        await interceptor.stop()

        assert not interceptor._enabled

    def test_should_capture_url_matching(self, interceptor):
        """Test URL matching for capture."""
        assert interceptor._should_capture_url("https://example.com/graphql")
        assert interceptor._should_capture_url("https://example.com/api/v1/users")
        assert not interceptor._should_capture_url("https://example.com/static/image.jpg")

    def test_should_ignore_mime(self, interceptor):
        """Test MIME type filtering."""
        assert interceptor._should_ignore_mime("image/jpeg")
        assert interceptor._should_ignore_mime("text/css")
        assert not interceptor._should_ignore_mime("application/json")


class TestCaptureService:
    """Tests for CaptureService class."""

    @pytest.fixture
    def capture_service(self):
        """Create a CaptureService instance."""
        return CaptureService(
            url_filters=["graphql", "api"],
            ignored_mimes=["image/"],
        )

    @pytest.fixture
    def mock_interceptor(self):
        """Create a mock CDP interceptor."""
        interceptor = MagicMock()
        interceptor.start = AsyncMock()
        interceptor.stop = AsyncMock()
        return interceptor

    def test_register_parser(self, capture_service):
        """Test registering a parser callback."""
        callback = AsyncMock()

        capture_service.register_parser("graphql", callback)

        assert "graphql" in capture_service._parsers
        assert callback in capture_service._parsers["graphql"]

    def test_register_multiple_parsers_same_pattern(self, capture_service):
        """Test registering multiple parsers for same pattern."""
        callback1 = AsyncMock()
        callback2 = AsyncMock()

        capture_service.register_parser("graphql", callback1)
        capture_service.register_parser("graphql", callback2)

        assert len(capture_service._parsers["graphql"]) == 2

    def test_unregister_parser(self, capture_service):
        """Test unregistering a parser."""
        callback = AsyncMock()
        capture_service.register_parser("graphql", callback)

        capture_service.unregister_parser("graphql", callback)

        assert len(capture_service._parsers.get("graphql", [])) == 0

    def test_unregister_all_for_pattern(self, capture_service):
        """Test unregistering all parsers for a pattern."""
        callback1 = AsyncMock()
        callback2 = AsyncMock()
        capture_service.register_parser("graphql", callback1)
        capture_service.register_parser("graphql", callback2)

        capture_service.unregister_parser("graphql")

        assert "graphql" not in capture_service._parsers

    @pytest.mark.asyncio
    async def test_start_service(self, capture_service, mock_interceptor):
        """Test starting capture service."""
        await capture_service.start(mock_interceptor)

        assert capture_service._running
        assert capture_service._interceptor is mock_interceptor
        mock_interceptor.start.assert_called_once()

    @pytest.mark.asyncio
    async def test_stop_service(self, capture_service, mock_interceptor):
        """Test stopping capture service."""
        await capture_service.start(mock_interceptor)
        await capture_service.stop()

        assert not capture_service._running
        mock_interceptor.stop.assert_called_once()


class TestNetworkCaptureEvent:
    """Tests for NetworkCaptureEvent model."""

    def test_event_creation(self):
        """Test creating a capture event."""
        event = NetworkCaptureEvent(
            event_id="test-123",
            event_type="response",
            url="https://example.com/api",
            method="GET",
            status=200,
            body='{"data": "test"}',
            timestamp=datetime.now(),
        )

        assert event.event_id == "test-123"
        assert event.event_type == "response"
        assert event.url == "https://example.com/api"
        assert event.status == 200

    def test_event_to_dict(self):
        """Test converting event to dictionary."""
        event = NetworkCaptureEvent(
            event_id="test-123",
            event_type="response",
            url="https://example.com/api",
            method="POST",
            status=200,
            body='{"result": "ok"}',
        )

        data = event.model_dump()

        assert data["event_id"] == "test-123"
        assert data["event_type"] == "response"
        assert data["method"] == "POST"


class TestRequestEvent:
    """Tests for RequestEvent model."""

    def test_request_event_creation(self):
        """Test creating a request event."""
        event = RequestEvent(
            request_id="req-123",
            url="https://example.com/graphql",
            method="POST",
            headers={"Content-Type": "application/json"},
            post_data='{"query": "test"}',
        )

        assert event.request_id == "req-123"
        assert event.url == "https://example.com/graphql"
        assert event.method == "POST"
        assert event.headers["Content-Type"] == "application/json"


class TestResponseEvent:
    """Tests for ResponseEvent model."""

    def test_response_event_creation(self):
        """Test creating a response event."""
        event = ResponseEvent(
            request_id="req-123",
            url="https://example.com/graphql",
            status=200,
            status_text="OK",
            mime_type="application/json",
            body='{"data": {"result": "success"}}',
        )

        assert event.request_id == "req-123"
        assert event.status == 200
        assert event.status_text == "OK"
        assert event.mime_type == "application/json"
