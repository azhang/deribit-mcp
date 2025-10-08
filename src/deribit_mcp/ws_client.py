"""WebSocket client for Deribit API real-time data."""

import asyncio
import json
import logging
from typing import Any, Optional
import websockets
from websockets.asyncio.client import ClientConnection

logger = logging.getLogger(__name__)


class WebSocketClient:
    """WebSocket client for Deribit public API subscriptions."""

    def __init__(self, base_url: str = "wss://www.deribit.com/ws/api/v2"):
        """Initialize WebSocket client.

        Args:
            base_url: Base WebSocket URL (use wss://test.deribit.com/ws/api/v2 for testing)
        """
        # Convert HTTP base URL to WebSocket if needed
        if base_url.startswith("http"):
            base_url = base_url.replace("https://", "wss://").replace("http://", "ws://")
            if not base_url.endswith("/ws/api/v2"):
                base_url = base_url.rstrip("/") + "/ws/api/v2"

        self.ws_url = base_url
        self.ws: Optional[ClientConnection] = None
        self._msg_id = 1
        self._pending_responses: dict[int, asyncio.Future] = {}
        self._subscriptions: dict[str, dict[str, Any]] = {}
        self._receive_task: Optional[asyncio.Task] = None

    def _next_id(self) -> int:
        """Get next message ID."""
        msg_id = self._msg_id
        self._msg_id += 1
        return msg_id

    async def connect(self) -> None:
        """Establish WebSocket connection and perform handshake."""
        if self.ws is not None:
            return  # Already connected

        logger.info(f"Connecting to {self.ws_url}")
        self.ws = await websockets.connect(self.ws_url)

        # Start message receiver task
        self._receive_task = asyncio.create_task(self._receive_messages())

        # Set heartbeat
        await self._call("public/set_heartbeat", {"interval": 10})

        # Send hello
        await self._call("public/hello", {
            "client_name": "deribit-mcp",
            "client_version": "0.1.0"
        })

        logger.info("WebSocket connected and handshake completed")

    async def close(self) -> None:
        """Close WebSocket connection."""
        if self._receive_task:
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass

        if self.ws:
            await self.ws.close()
            self.ws = None
            logger.info("WebSocket connection closed")

    async def _call(self, method: str, params: Optional[dict[str, Any]] = None) -> Any:
        """Make a JSON-RPC call and wait for response.

        Args:
            method: The API method to call
            params: Optional parameters

        Returns:
            The result from the API response
        """
        if self.ws is None:
            raise RuntimeError("WebSocket not connected")

        msg_id = self._next_id()
        message = {
            "jsonrpc": "2.0",
            "id": msg_id,
            "method": method,
            "params": params or {}
        }

        # Create future for this request
        future: asyncio.Future = asyncio.Future()
        self._pending_responses[msg_id] = future

        # Send message
        await self.ws.send(json.dumps(message))

        # Wait for response
        try:
            result = await asyncio.wait_for(future, timeout=10.0)
            return result
        finally:
            self._pending_responses.pop(msg_id, None)

    async def _receive_messages(self) -> None:
        """Background task to receive and route messages."""
        try:
            async for message in self.ws:
                try:
                    data = json.loads(message)
                    await self._handle_message(data)
                except json.JSONDecodeError:
                    logger.error(f"Failed to parse message: {message}")
                except Exception as e:
                    logger.error(f"Error handling message: {e}")
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error in receive loop: {e}")

    async def _handle_message(self, data: dict[str, Any]) -> None:
        """Handle incoming message - either RPC response or subscription notification.

        Args:
            data: Parsed JSON message
        """
        # Check if this is a subscription notification
        if data.get("method") == "subscription":
            channel = data["params"]["channel"]
            subscription_data = data["params"]["data"]

            # Store subscription data
            self._subscriptions[channel] = subscription_data
            logger.debug(f"Received subscription update for {channel}")
            return

        # Otherwise it's an RPC response
        msg_id = data.get("id")
        if msg_id is None:
            return

        future = self._pending_responses.get(msg_id)
        if future and not future.done():
            if "error" in data:
                error = data["error"]
                future.set_exception(
                    ValueError(f"API Error {error.get('code')}: {error.get('message')}")
                )
            else:
                future.set_result(data.get("result"))

    async def subscribe_tickers(self, instrument_names: list[str]) -> None:
        """Subscribe to ticker updates for multiple instruments.

        Args:
            instrument_names: List of instrument names to subscribe to
        """
        channels = [f"incremental_ticker.{name}" for name in instrument_names]

        logger.info(f"Subscribing to {len(channels)} ticker channels")
        result = await self._call("public/subscribe", {"channels": channels})
        logger.info(f"Subscribed to {len(result)} channels")

    async def wait_for_snapshots(
        self,
        instrument_names: list[str],
        timeout: float = 10.0
    ) -> dict[str, dict[str, Any]]:
        """Wait for initial snapshot data for all instruments.

        Args:
            instrument_names: List of instrument names
            timeout: Maximum time to wait in seconds

        Returns:
            Dictionary mapping instrument name to ticker data

        Raises:
            TimeoutError: If snapshots don't arrive in time
        """
        channels = {f"incremental_ticker.{name}" for name in instrument_names}
        start_time = asyncio.get_event_loop().time()

        logger.info(f"Waiting for {len(channels)} snapshots...")

        while True:
            # Check if we have all snapshots
            received = {
                channel for channel in channels
                if channel in self._subscriptions
            }

            if received == channels:
                # Got all snapshots!
                result = {
                    name: self._subscriptions[f"incremental_ticker.{name}"]
                    for name in instrument_names
                }
                logger.info(f"Received all {len(result)} snapshots")
                return result

            # Check timeout
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > timeout:
                missing = len(channels) - len(received)
                raise TimeoutError(
                    f"Timeout waiting for snapshots. Received {len(received)}/{len(channels)} "
                    f"({missing} missing)"
                )

            # Wait a bit before checking again
            await asyncio.sleep(0.1)

    async def get_ticker_snapshots(
        self,
        instrument_names: list[str],
        timeout: float = 10.0
    ) -> dict[str, dict[str, Any]]:
        """Subscribe to instruments and get their initial snapshot data.

        This is a convenience method that combines subscribe + wait_for_snapshots.

        Args:
            instrument_names: List of instrument names
            timeout: Maximum time to wait for snapshots

        Returns:
            Dictionary mapping instrument name to ticker data
        """
        await self.subscribe_tickers(instrument_names)
        return await self.wait_for_snapshots(instrument_names, timeout)
