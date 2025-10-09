"""MCP server for Deribit public API."""

import json
import os
from typing import Literal
from fastmcp import FastMCP
from .deribit import DeribitClient

# Initialize FastMCP server
mcp = FastMCP("deribit-mcp")

# Global client instance
client: DeribitClient | None = None


def get_client() -> DeribitClient:
    """Get or create the Deribit client."""
    global client
    if client is None:
        client = DeribitClient()
    return client


@mcp.tool()
async def get_ticker(instrument_name: str) -> str:
    """Get current ticker information for a Deribit instrument.

    Returns prices, volume, bid/ask spreads, and other market data.

    Args:
        instrument_name: The instrument name (e.g., 'BTC-PERPETUAL', 'ETH-25OCT24-3000-C')
    """
    try:
        client = get_client()
        result = await client.get_ticker(instrument_name)
        return json.dumps(result, indent=2)
    except Exception as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def get_order_book(instrument_name: str, depth: int | None = None) -> str:
    """Get the current order book for a Deribit instrument.

    Shows bids and asks at different price levels.

    Args:
        instrument_name: The instrument name (e.g., 'BTC-PERPETUAL')
        depth: Order book depth (optional, varies by instrument type)
    """
    try:
        client = get_client()
        result = await client.get_order_book(instrument_name, depth)
        return json.dumps(result, indent=2)
    except Exception as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def get_instruments(
    currency: str,
    kind: Literal["future", "option", "spot", "future_combo", "option_combo"] | None = None,
    expired: bool = False
) -> str:
    """Get a list of available trading instruments for a specific currency.

    Can filter by instrument kind (future, option, spot, etc.). Returns CSV format.

    Args:
        currency: Currency symbol (e.g., 'BTC', 'ETH', 'USDC')
        kind: Instrument kind: 'future', 'option', 'spot', 'future_combo', or 'option_combo' (optional)
        expired: Include expired instruments (default: false)
    """
    try:
        client = get_client()
        result = await client.get_instruments(currency, kind, expired)
        return result  # Already CSV format
    except Exception as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def get_last_trades(
    instrument_name: str,
    count: int | None = None,
    include_old: bool = False
) -> str:
    """Get recent trade history for a Deribit instrument.

    Includes trade prices, sizes, and timestamps.

    Args:
        instrument_name: The instrument name (e.g., 'BTC-PERPETUAL')
        count: Number of trades to retrieve (default: 10, max: 1000)
        include_old: Include old trades (default: false)
    """
    try:
        client = get_client()
        result = await client.get_last_trades_by_instrument(
            instrument_name, count, include_old
        )
        return json.dumps(result, indent=2)
    except Exception as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def get_currencies() -> str:
    """Get a list of all available currencies on Deribit.

    Includes their properties and trading information.
    """
    try:
        client = get_client()
        result = await client.get_currencies()
        return json.dumps(result, indent=2)
    except Exception as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def get_index_price(index_name: str) -> str:
    """Get the current index price for a currency pair.

    The index price is calculated from multiple exchanges.

    Args:
        index_name: Index name (e.g., 'btc_usd', 'eth_usd', 'sol_usd')
    """
    try:
        client = get_client()
        result = await client.get_index_price(index_name)
        return json.dumps(result, indent=2)
    except Exception as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def get_expirations(
    currency: str,
    kind: Literal["future", "option", "any"],
    currency_pair: str | None = None
) -> str:
    """Get available expiration dates for instruments.

    Much more efficient than calling get_instruments to find expirations. Returns CSV format.

    Args:
        currency: Currency symbol: BTC, ETH, USDC, USDT, 'any' for all, or 'grouped' for all grouped by currency
        kind: Instrument kind: 'future', 'option', or 'any'
        currency_pair: Optional currency pair filter (e.g., 'eth_usdc', 'btc_usd', 'sol_usdc')
    """
    try:
        client = get_client()
        result = await client.get_expirations(currency, kind, currency_pair)
        return result  # Already CSV format
    except Exception as e:
        return f"Error: {str(e)}"


@mcp.tool()
async def get_options_chain(
    currency: str,
    expiry: str,
    min_strike: float | None = None,
    max_strike: float | None = None
) -> str:
    """Get complete options chain for a specific expiry with real-time greeks.

    Returns data in CSV format for easy table viewing. Uses WebSocket for efficient real-time data.
    Includes prices, volumes, open interest, delta, gamma, vega, theta, rho, and IV.

    Args:
        currency: Settlement currency: 'BTC' for BTC-settled options (e.g., ETH-9OCT25-4000-C),
                  'USDC' for USDC-settled options (e.g., ETH_USDC-9OCT25-4000-C, SOL_USDC-...).
                  Valid values: BTC, ETH, USDC, USDT, EURR
        expiry: Expiry date in format like '9OCT25', '27MAR25', or 'DDMMMYY'
        min_strike: Optional minimum strike price to filter results
        max_strike: Optional maximum strike price to filter results
    """
    try:
        client = get_client()
        result = await client.get_options_chain(currency, expiry, min_strike, max_strike)
        return result  # Already CSV format
    except Exception as e:
        return f"Error: {str(e)}"


def run():
    """Run the MCP server with transport specified by environment or CLI."""
    transport = os.environ.get("MCP_TRANSPORT", "stdio")

    if transport == "http":
        host = os.environ.get("MCP_HOST", "0.0.0.0")
        port = int(os.environ.get("MCP_PORT", "8000"))
        mcp.run(transport="http", host=host, port=port, stateless_http=True)
    else:
        mcp.run(transport="stdio")


if __name__ == "__main__":
    run()
