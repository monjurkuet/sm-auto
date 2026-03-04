"""
CDP Network Interceptor for SM-Auto framework.

Captures network traffic using Chrome DevTools Protocol
via nodriver's CDP interface.
"""

import asyncio
import base64
import json
from typing import Optional, List, Callable, Any, Dict
from datetime import datetime

import nodriver as uc
from nodriver.core.tab import Tab

from sm_auto.utils.logger import get_logger
from sm_auto.core.network.models import RequestEvent, ResponseEvent, NetworkCaptureEvent
from sm_auto.core.exceptions import NetworkInterceptionError

logger = get_logger(__name__)


class CDPInterceptor:
    """
    Intercepts network traffic using Chrome DevTools Protocol.

    Listens to network events and captures request/response data
    for analysis and processing.
    """

    def __init__(
        self,
        tab: Tab,
        queue: asyncio.Queue,
        url_filters: Optional[List[str]] = None,
        ignored_mimes: Optional[List[str]] = None,
    ):
        """
        Initialize the CDP Interceptor.

        Args:
            tab: The browser tab to monitor.
            queue: Async queue to push captured events to.
            url_filters: List of URL patterns to filter for (e.g., ['graphql', 'api']).
            ignored_mimes: List of MIME type prefixes to ignore.
        """
        self.tab = tab
        self.queue = queue
        self.url_filters = url_filters or ["graphql", "api", "ajax"]
        self.ignored_mimes = ignored_mimes or [
            "image/",
            "text/css",
            "font/",
            "application/font",
        ]
        self._enabled = False
        self._request_map: Dict[str, RequestEvent] = {}

    def _should_capture_url(self, url: str) -> bool:
        """
        Check if a URL matches the capture filters.

        Args:
            url: URL to check.

        Returns:
            True if URL should be captured.
        """
        url_lower = url.lower()
        return any(pattern in url_lower for pattern in self.url_filters)

    def _should_ignore_mime(self, mime_type: str) -> bool:
        """
        Check if a MIME type should be ignored.

        Args:
            mime_type: MIME type to check.

        Returns:
            True if MIME type should be ignored.
        """
        return any(mime_type.startswith(prefix) for prefix in self.ignored_mimes)

    async def start(self) -> None:
        """
        Start network interception.

        Enables the Network domain and registers event handlers.
        """
        if self._enabled:
            logger.warning("CDP Interceptor already started")
            return

        logger.info("Starting CDP network interception...")

        try:
            # Enable Network domain
            await self.tab.send(uc.cdp.network.enable())
            logger.debug("Network domain enabled")

            # Register request handler
            self.tab.add_handler(
                uc.cdp.network.RequestWillBeSent,
                self._on_request_will_be_sent,
            )

            # Register response handler
            self.tab.add_handler(
                uc.cdp.network.ResponseReceived,
                self._on_response_received,
            )

            self._enabled = True
            logger.info("CDP network interception started")

        except Exception as e:
            logger.error(f"Failed to start CDP interception: {e}")
            raise NetworkInterceptionError(f"Failed to start CDP interception: {e}")

    async def stop(self) -> None:
        """Stop network interception."""
        if not self._enabled:
            return

        logger.info("Stopping CDP network interception...")

        try:
            # Disable Network domain
            await self.tab.send(uc.cdp.network.disable())

            # Remove handlers
            self.tab.remove_handler(uc.cdp.network.RequestWillBeSent)
            self.tab.remove_handler(uc.cdp.network.ResponseReceived)

            self._enabled = False
            self._request_map.clear()

            logger.info("CDP network interception stopped")

        except Exception as e:
            logger.error(f"Error stopping CDP interception: {e}")

    async def _on_request_will_be_sent(
        self, event: uc.cdp.network.RequestWillBeSent
    ) -> None:
        """
        Handle request will be sent event.

        Args:
            event: CDP RequestWillBeSent event.
        """
        url = event.request.url

        # Check if we should capture this request
        if not self._should_capture_url(url):
            return

        logger.debug(f"Captured request: {url}")

        # Create request event
        request_event = RequestEvent(
            request_id=event.request_id,
            url=url,
            method=event.request.method,
            headers=dict(event.request.headers),
            post_data=event.request.post_data,
            timestamp=datetime.now(),
        )

        # Store in request map for later correlation
        self._request_map[event.request_id] = request_event

        # Push to queue
        capture_event = NetworkCaptureEvent(
            event_type="request",
            url=url,
            method=event.request.method,
            headers=dict(event.request.headers),
            body=event.request.post_data,
            metadata={"request_id": event.request_id},
        )

        await self.queue.put(capture_event)

    async def _on_response_received(
        self, event: uc.cdp.network.ResponseReceived
    ) -> None:
        """
        Handle response received event.

        Args:
            event: CDP ResponseReceived event.
        """
        url = event.response.url

        # Check if we should capture this response
        if not self._should_capture_url(url):
            return

        # Check if we should ignore this MIME type
        if self._should_ignore_mime(event.response.mime_type):
            return

        logger.debug(f"Captured response: {url}")

        # Try to get response body
        body = None
        try:
            body_data, base64encoded = await self.tab.send(
                uc.cdp.network.get_response_body(event.request_id)
            )

            if body_data is not None:
                if base64encoded:
                    body = base64.b64decode(body_data).decode("utf-8", errors="ignore")
                else:
                    body = body_data

        except Exception as e:
            logger.debug(f"Could not get response body: {e}")

        # Create response event
        response_event = ResponseEvent(
            request_id=event.request_id,
            url=url,
            status=event.response.status,
            status_text=event.response.status_text or "",
            mime_type=event.response.mime_type,
            headers=dict(event.response.headers),
            body=body,
            timestamp=datetime.now(),
        )

        # Push to queue
        capture_event = NetworkCaptureEvent(
            event_type="response",
            url=url,
            status=event.response.status,
            mime_type=event.response.mime_type,
            headers=dict(event.response.headers),
            body=body,
            metadata={
                "request_id": event.request_id,
                "status": event.response.status,
            },
        )
        
        print(f"[CDP] Pushing response to queue: {url}, body length: {len(body) if body else 0}")  # Debug

        await self.queue.put(capture_event)

    async def capture_request_body(self, request_id: str) -> Optional[str]:
        """
        Capture the body of a request.

        Args:
            request_id: The request ID to fetch body for.

        Returns:
            Request body string or None.
        """
        try:
            body_data, base64encoded = await self.tab.send(
                uc.cdp.network.get_request_body(request_id)
            )

            if body_data is None:
                return None

            if base64encoded:
                return base64.b64decode(body_data).decode("utf-8", errors="ignore")
            return body_data

        except Exception as e:
            logger.debug(f"Could not get request body: {e}")
            return None

    async def capture_response_body(self, request_id: str) -> Optional[str]:
        """
        Capture the body of a response.

        Args:
            request_id: The request ID to fetch body for.

        Returns:
            Response body string or None.
        """
        try:
            body_data, base64encoded = await self.tab.send(
                uc.cdp.network.get_response_body(request_id)
            )

            if body_data is None:
                return None

            if base64encoded:
                return base64.b64decode(body_data).decode("utf-8", errors="ignore")
            return body_data

        except Exception as e:
            logger.debug(f"Could not get response body: {e}")
            return None

    def get_request(self, request_id: str) -> Optional[RequestEvent]:
        """
        Get a stored request event by ID.

        Args:
            request_id: The request ID.

        Returns:
            RequestEvent or None.
        """
        return self._request_map.get(request_id)
