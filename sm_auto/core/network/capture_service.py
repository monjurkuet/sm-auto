"""
Network Capture Service for SM-Auto framework.

Orchestrates network interception, filters payloads,
and routes data to platform-specific parsers.
"""

import asyncio
import json
from typing import Optional, List, Callable, Any, Dict, Type
from datetime import datetime

from sm_auto.utils.logger import get_logger
from sm_auto.core.network.models import NetworkCaptureEvent, GraphQLResponse
from sm_auto.core.network.cdp_interceptor import CDPInterceptor
from sm_auto.core.exceptions import NetworkInterceptionError

logger = get_logger(__name__)


# Type alias for parser callback
ParserCallback = Callable[[NetworkCaptureEvent], Any]


class CaptureService:
    """
    Service for managing network capture and routing.

    Coordinates the CDP interceptor, filters captured data,
    and routes payloads to registered parsers.
    """

    def __init__(
        self,
        url_filters: Optional[List[str]] = None,
        ignored_mimes: Optional[List[str]] = None,
    ):
        """
        Initialize the CaptureService.

        Args:
            url_filters: List of URL patterns to filter for.
            ignored_mimes: List of MIME type prefixes to ignore.
        """
        self.url_filters = url_filters or ["graphql", "api", "ajax"]
        self.ignored_mimes = ignored_mimes or [
            "image/",
            "text/css",
            "font/",
            "application/font",
        ]

        self._interceptor: Optional[CDPInterceptor] = None
        self._queue: asyncio.Queue = asyncio.Queue()
        self._parsers: Dict[str, List[ParserCallback]] = {}
        self._running = False
        self._processor_task: Optional[asyncio.Task] = None

    def register_parser(
        self,
        url_pattern: str,
        callback: ParserCallback,
    ) -> None:
        """
        Register a parser callback for a URL pattern.

        Args:
            url_pattern: URL pattern to match (e.g., 'graphql', 'marketplace').
            callback: Async callback function to process matching events.
        """
        if url_pattern not in self._parsers:
            self._parsers[url_pattern] = []
        self._parsers[url_pattern].append(callback)
        logger.debug(f"Registered parser for pattern: {url_pattern}")

    def unregister_parser(
        self,
        url_pattern: str,
        callback: Optional[ParserCallback] = None,
    ) -> None:
        """
        Unregister a parser callback.

        Args:
            url_pattern: URL pattern to unregister.
            callback: Specific callback to remove. If None, removes all for pattern.
        """
        if url_pattern not in self._parsers:
            return

        if callback is None:
            del self._parsers[url_pattern]
        else:
            self._parsers[url_pattern] = [
                cb for cb in self._parsers[url_pattern] if cb != callback
            ]

            if not self._parsers[url_pattern]:
                del self._parsers[url_pattern]

    async def start(self, interceptor: CDPInterceptor) -> None:
        """
        Start the capture service.

        Args:
            interceptor: CDPInterceptor instance to use.
        """
        if self._running:
            logger.warning("CaptureService already running")
            return

        self._interceptor = interceptor
        # Use the interceptor's queue so we receive the events it captures
        self._queue = interceptor.queue
        self._running = True

        # Start the queue processor
        self._processor_task = asyncio.create_task(self._process_queue())

        logger.info("CaptureService started")

    async def stop(self) -> None:
        """Stop the capture service."""
        if not self._running:
            return

        self._running = False

        # Cancel processor task
        if self._processor_task:
            self._processor_task.cancel()
            try:
                await self._processor_task
            except asyncio.CancelledError:
                pass

        # Stop interceptor
        if self._interceptor:
            await self._interceptor.stop()

        # Clear queue
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break

        logger.info("CaptureService stopped")

    async def _process_queue(self) -> None:
        """
        Process events from the capture queue.

        Routes events to registered parsers based on URL patterns.
        """
        logger.debug("[CaptureService] Starting queue processor")
        while self._running:
            try:
                # Get event from queue with timeout
                try:
                    event = await asyncio.wait_for(
                        self._queue.get(), timeout=1.0
                    )
                    logger.debug(f"[CaptureService] Got event from queue: {event.url}, body: {len(event.body) if event.body else 0}")
                except asyncio.TimeoutError:
                    continue

                # Process the event
                await self._route_event(event)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error processing queue event: {e}")

    async def _route_event(self, event: NetworkCaptureEvent) -> None:
        """
        Route a capture event to registered parsers.

        Args:
            event: The network capture event to route.
        """
        # Only process responses with bodies
        if event.event_type != "response" or not event.body:
            return

        logger.debug(f"[CaptureService] Routing event: {event.event_type}, URL: {event.url}, body length: {len(event.body) if event.body else 0}")

        url_lower = event.url.lower()

        # Find matching parsers
        for pattern, callbacks in self._parsers.items():
            if pattern.lower() in url_lower:
                logger.debug(f"[CaptureService] Matching pattern: {pattern}, callbacks: {len(callbacks)}")
                for callback in callbacks:
                    try:
                        await callback(event)
                    except Exception as e:
                        logger.error(f"Parser error for pattern {pattern}: {e}")

    async def wait_for_event(
        self,
        url_pattern: Optional[str] = None,
        timeout: Optional[float] = None,
    ) -> Optional[NetworkCaptureEvent]:
        """
        Wait for a matching capture event.

        Args:
            url_pattern: Optional URL pattern to filter for.
            timeout: Optional timeout in seconds.

        Returns:
            Matching NetworkCaptureEvent or None.
        """
        start_time = datetime.now()

        while True:
            # Check timeout
            if timeout:
                elapsed = (datetime.now() - start_time).total_seconds()
                if elapsed >= timeout:
                    return None

            # Get event from queue
            try:
                event = await asyncio.wait_for(self._queue.get(), timeout=0.5)

                # Check URL pattern
                if url_pattern is None or url_pattern in event.url.lower():
                    return event

            except asyncio.TimeoutError:
                continue

    async def capture_graphql_response(
        self,
        query_name: Optional[str] = None,
        timeout: float = 30.0,
    ) -> Optional[GraphQLResponse]:
        """
        Capture a GraphQL response.

        Args:
            query_name: Optional GraphQL query name to filter for.
            timeout: Timeout in seconds.

        Returns:
            GraphQLResponse or None.
        """
        event = await self.wait_for_event(
            url_pattern="graphql",
            timeout=timeout,
        )

        if event is None or not event.body:
            return None

        try:
            data = json.loads(event.body)
            return GraphQLResponse(
                url=event.url,
                data=data.get("data"),
                errors=data.get("errors"),
                extensions=data.get("extensions"),
            )
        except json.JSONDecodeError as e:
            logger.debug(f"Failed to parse GraphQL response: {e}")
            return None

    async def capture_all_events(
        self,
        duration: float,
        url_pattern: Optional[str] = None,
    ) -> List[NetworkCaptureEvent]:
        """
        Capture all events for a specified duration.

        Args:
            duration: Duration to capture in seconds.
            url_pattern: Optional URL pattern to filter for.

        Returns:
            List of captured events.
        """
        events = []
        end_time = datetime.now().timestamp() + duration

        while datetime.now().timestamp() < end_time:
            try:
                event = await asyncio.wait_for(
                    self._queue.get(), timeout=0.5
                )

                if url_pattern is None or url_pattern in event.url.lower():
                    events.append(event)

            except asyncio.TimeoutError:
                continue

        return events
