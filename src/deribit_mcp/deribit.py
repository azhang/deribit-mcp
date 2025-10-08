"""Deribit API client for public endpoints."""

import httpx
from typing import Any, Optional
from .ws_client import WebSocketClient
from .options import filter_instruments_by_expiry, build_options_chain_csv


class DeribitClient:
    """Client for Deribit public API endpoints using JSON-RPC 2.0.

    Supports both HTTP and WebSocket protocols:
    - HTTP for simple request/response queries
    - WebSocket for real-time subscriptions and options chain data
    """

    def __init__(self, base_url: str = "https://www.deribit.com/api/v2"):
        self.base_url = base_url
        self.client = httpx.AsyncClient(timeout=30.0)
        self.ws_client: Optional[WebSocketClient] = None

    async def close(self):
        """Close both HTTP and WebSocket clients."""
        await self.client.aclose()
        if self.ws_client:
            await self.ws_client.close()

    async def _call(self, method: str, params: Optional[dict[str, Any]] = None) -> Any:
        """Make a call to the Deribit REST API.

        Args:
            method: The API method to call (e.g., "ticker")
            params: Optional parameters for the method

        Returns:
            The result from the API response

        Raises:
            httpx.HTTPError: If the HTTP request fails
            ValueError: If the API returns an error
        """
        # Use GET with query parameters for Deribit REST API
        response = await self.client.get(
            f"{self.base_url}/public/{method}",
            params=params or {}
        )
        response.raise_for_status()

        data = response.json()

        if "error" in data:
            error = data["error"]
            raise ValueError(f"API Error {error.get('code')}: {error.get('message')}")

        return data.get("result")

    async def get_ticker(self, instrument_name: str) -> dict[str, Any]:
        """Get ticker information for an instrument.

        Args:
            instrument_name: The instrument name (e.g., "BTC-PERPETUAL")

        Returns:
            Ticker data including prices, volume, and other market info
        """
        return await self._call("ticker", {"instrument_name": instrument_name})

    async def get_order_book(
        self,
        instrument_name: str,
        depth: Optional[int] = None
    ) -> dict[str, Any]:
        """Get the order book for an instrument.

        Args:
            instrument_name: The instrument name (e.g., "BTC-PERPETUAL")
            depth: Optional order book depth (default varies by instrument)

        Returns:
            Order book data with bids and asks
        """
        params = {"instrument_name": instrument_name}
        if depth is not None:
            params["depth"] = depth
        return await self._call("get_order_book", params)

    async def _get_instruments_raw(
        self,
        currency: str,
        kind: Optional[str] = None,
        expired: bool = False
    ) -> list[dict[str, Any]]:
        """Internal method to get raw instruments list.

        Args:
            currency: Currency symbol (e.g., "BTC", "ETH")
            kind: Optional instrument kind
            expired: Whether to include expired instruments

        Returns:
            List of instrument data
        """
        params = {"currency": currency, "expired": expired}
        if kind is not None:
            params["kind"] = kind
        return await self._call("get_instruments", params)

    async def get_instruments(
        self,
        currency: str,
        kind: Optional[str] = None,
        expired: bool = False
    ) -> str:
        """Get available instruments for a currency.

        Args:
            currency: Currency symbol (e.g., "BTC", "ETH")
            kind: Optional instrument kind ("future", "option", "spot", "future_combo", "option_combo")
            expired: Whether to include expired instruments

        Returns:
            CSV string with essential instrument fields
        """
        instruments = await self._get_instruments_raw(currency, kind, expired)

        # Convert to CSV with only essential fields
        if not instruments:
            return "instrument_name\n"

        # For options, include option-specific fields
        if kind == "option":
            header = "instrument_name,kind,strike,option_type,expiration_timestamp,is_active,settlement_currency"
            rows = [header]
            for inst in instruments:
                rows.append(
                    f"{inst['instrument_name']},"
                    f"{inst['kind']},"
                    f"{inst.get('strike', '')},"
                    f"{inst.get('option_type', '')},"
                    f"{inst['expiration_timestamp']},"
                    f"{inst['is_active']},"
                    f"{inst['settlement_currency']}"
                )
        else:
            # For futures/spots, simpler format
            header = "instrument_name,kind,expiration_timestamp,is_active,settlement_currency"
            rows = [header]
            for inst in instruments:
                rows.append(
                    f"{inst['instrument_name']},"
                    f"{inst['kind']},"
                    f"{inst.get('expiration_timestamp', '')},"
                    f"{inst['is_active']},"
                    f"{inst['settlement_currency']}"
                )

        return "\n".join(rows)

    async def get_last_trades_by_instrument(
        self,
        instrument_name: str,
        count: Optional[int] = None,
        include_old: bool = False
    ) -> dict[str, Any]:
        """Get recent trades for an instrument.

        Args:
            instrument_name: The instrument name (e.g., "BTC-PERPETUAL")
            count: Number of trades to retrieve (default 10, max 1000)
            include_old: Whether to include old trades

        Returns:
            Trade data including prices, amounts, and timestamps
        """
        params = {"instrument_name": instrument_name, "include_old": include_old}
        if count is not None:
            params["count"] = count
        return await self._call("get_last_trades_by_instrument", params)

    async def get_currencies(self) -> list[dict[str, Any]]:
        """Get all available currencies.

        Returns:
            List of currency data
        """
        return await self._call("get_currencies")

    async def get_index_price(self, index_name: str) -> dict[str, Any]:
        """Get the current index price.

        Args:
            index_name: Index name (e.g., "btc_usd", "eth_usd")

        Returns:
            Index price data
        """
        return await self._call("get_index_price", {"index_name": index_name})

    async def get_expirations(
        self,
        currency: str,
        kind: str,
        currency_pair: Optional[str] = None
    ) -> str:
        """Get available expiration dates for instruments.

        Args:
            currency: Currency symbol (BTC, ETH, USDC, USDT, "any", or "grouped")
            kind: Instrument kind ("future", "option", or "any")
            currency_pair: Optional currency pair filter (e.g., "eth_usdc", "btc_usd")

        Returns:
            CSV string with expirations
        """
        params = {"currency": currency, "kind": kind}
        if currency_pair is not None:
            params["currency_pair"] = currency_pair

        result = await self._call("get_expirations", params)

        # Result structure depends on currency parameter:
        # - Specific currency/currency_pair: {currency: {kind: [expirations]}}
        # - "any": {kind: [expirations]}
        # - "grouped": {currency: {kind: [expirations]}}

        rows = ["currency,kind,expiration"]

        if not result:
            return "\n".join(rows)

        # Check if first value is a dict (grouped format) or list (any format)
        first_value = next(iter(result.values()))

        if isinstance(first_value, dict):
            # Grouped format: {currency: {kind: [expirations]}}
            for curr, kinds in result.items():
                for k, expirations in kinds.items():
                    for expiry in expirations:
                        rows.append(f"{curr},{k},{expiry}")
        else:
            # "any" format: {kind: [expirations]}
            for k, expirations in result.items():
                for expiry in expirations:
                    rows.append(f"any,{k},{expiry}")

        return "\n".join(rows)

    async def get_options_chain(
        self,
        currency: str,
        expiry: str,
        min_strike: Optional[float] = None,
        max_strike: Optional[float] = None
    ) -> str:
        """Get complete options chain data for a specific expiry.

        This method combines HTTP and WebSocket:
        1. Fetches instrument list via HTTP (get_instruments)
        2. Filters instruments by expiry date
        3. Subscribes to all instruments via WebSocket
        4. Waits for initial ticker snapshots with greeks
        5. Builds CSV representation of the options chain

        Args:
            currency: Currency symbol (e.g., "BTC", "ETH", "ETH_USDC")
            expiry: Expiry date in format "9OCT25" or "DDMMMYY"
            min_strike: Optional minimum strike price filter
            max_strike: Optional maximum strike price filter

        Returns:
            CSV formatted string with header comments containing:
            - Metadata (currency, expiry, timestamp, underlying/index prices)
            - Option data: strikes, prices, greeks, volume, open interest

        Example:
            >>> client = DeribitClient()
            >>> csv = await client.get_options_chain("ETH_USDC", "9OCT25")
            >>> print(csv)
            # Currency: ETH_USDC
            # Expiry: 9OCT25
            # Timestamp: 1759922575385
            # Underlying: 4494.76
            # Index: 4495.25
            strike,type,instrument_name,mark_price,bid_price,ask_price,...
            4000,call,ETH_USDC-9OCT25-4000-C,495.42,494.0,497.0,...
            4000,put,ETH_USDC-9OCT25-4000-P,0.18,0.1,0.3,...
        """
        # Step 1: Get all option instruments for this currency (HTTP)
        instruments = await self._get_instruments_raw(currency, kind="option", expired=False)

        # Step 2: Filter instruments by expiry date
        instrument_names = filter_instruments_by_expiry(instruments, expiry)

        if not instrument_names:
            return f"# No instruments found for {currency} expiry {expiry}\n"

        # Step 3: Connect WebSocket if not already connected
        if self.ws_client is None:
            # Convert HTTP URL to WebSocket URL
            ws_url = self.base_url.replace("https://", "wss://").replace("http://", "ws://")
            if not ws_url.endswith("/ws/api/v2"):
                ws_url = ws_url.rsplit("/api/v2", 1)[0] + "/ws/api/v2"

            self.ws_client = WebSocketClient(ws_url)
            await self.ws_client.connect()

        # Step 4: Subscribe and get ticker snapshots (WebSocket)
        ticker_data = await self.ws_client.get_ticker_snapshots(instrument_names)

        # Step 5: Build CSV from ticker data
        csv_output = build_options_chain_csv(
            ticker_data,
            currency,
            expiry,
            min_strike,
            max_strike
        )

        return csv_output
