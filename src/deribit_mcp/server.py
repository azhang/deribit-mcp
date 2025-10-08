"""MCP server for Deribit public API."""

import json
from typing import Any
from mcp.server import Server
from mcp.types import Tool, TextContent
from pydantic import Field
from .deribit import DeribitClient

# Initialize the MCP server
app = Server("deribit-mcp")

# Global client instance
client: DeribitClient | None = None


@app.list_tools()
async def list_tools() -> list[Tool]:
    """List available tools."""
    return [
        Tool(
            name="get_ticker",
            description="Get current ticker information for a Deribit instrument. Returns prices, volume, bid/ask spreads, and other market data.",
            inputSchema={
                "type": "object",
                "properties": {
                    "instrument_name": {
                        "type": "string",
                        "description": "The instrument name (e.g., 'BTC-PERPETUAL', 'ETH-25OCT24-3000-C')",
                    }
                },
                "required": ["instrument_name"],
            },
        ),
        Tool(
            name="get_order_book",
            description="Get the current order book for a Deribit instrument, showing bids and asks at different price levels.",
            inputSchema={
                "type": "object",
                "properties": {
                    "instrument_name": {
                        "type": "string",
                        "description": "The instrument name (e.g., 'BTC-PERPETUAL')",
                    },
                    "depth": {
                        "type": "integer",
                        "description": "Order book depth (optional, varies by instrument type)",
                    },
                },
                "required": ["instrument_name"],
            },
        ),
        Tool(
            name="get_instruments",
            description="Get a list of available trading instruments for a specific currency. Can filter by instrument kind (future, option, spot, etc.).",
            inputSchema={
                "type": "object",
                "properties": {
                    "currency": {
                        "type": "string",
                        "description": "Currency symbol (e.g., 'BTC', 'ETH', 'USDC')",
                    },
                    "kind": {
                        "type": "string",
                        "description": "Instrument kind: 'future', 'option', 'spot', 'future_combo', or 'option_combo' (optional)",
                        "enum": ["future", "option", "spot", "future_combo", "option_combo"],
                    },
                    "expired": {
                        "type": "boolean",
                        "description": "Include expired instruments (default: false)",
                    },
                },
                "required": ["currency"],
            },
        ),
        Tool(
            name="get_last_trades",
            description="Get recent trade history for a Deribit instrument, including trade prices, sizes, and timestamps.",
            inputSchema={
                "type": "object",
                "properties": {
                    "instrument_name": {
                        "type": "string",
                        "description": "The instrument name (e.g., 'BTC-PERPETUAL')",
                    },
                    "count": {
                        "type": "integer",
                        "description": "Number of trades to retrieve (default: 10, max: 1000)",
                    },
                    "include_old": {
                        "type": "boolean",
                        "description": "Include old trades (default: false)",
                    },
                },
                "required": ["instrument_name"],
            },
        ),
        Tool(
            name="get_currencies",
            description="Get a list of all available currencies on Deribit with their properties and trading information.",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
        Tool(
            name="get_index_price",
            description="Get the current index price for a currency pair. The index price is calculated from multiple exchanges.",
            inputSchema={
                "type": "object",
                "properties": {
                    "index_name": {
                        "type": "string",
                        "description": "Index name (e.g., 'btc_usd', 'eth_usd', 'sol_usd')",
                    }
                },
                "required": ["index_name"],
            },
        ),
        Tool(
            name="get_options_chain",
            description="Get complete options chain for a specific expiry with real-time greeks, prices, volumes, and open interest. Returns data in CSV format for easy table viewing. Uses WebSocket for efficient real-time data.",
            inputSchema={
                "type": "object",
                "properties": {
                    "currency": {
                        "type": "string",
                        "description": "Settlement currency: 'BTC' for BTC-settled options (e.g., ETH-9OCT25-4000-C), 'USDC' for USDC-settled options (e.g., ETH_USDC-9OCT25-4000-C, SOL_USDC-...). Valid values: BTC, ETH, USDC, USDT, EURR",
                    },
                    "expiry": {
                        "type": "string",
                        "description": "Expiry date in format like '9OCT25', '27MAR25', or 'DDMMMYY'",
                    },
                    "min_strike": {
                        "type": "number",
                        "description": "Optional minimum strike price to filter results",
                    },
                    "max_strike": {
                        "type": "number",
                        "description": "Optional maximum strike price to filter results",
                    },
                },
                "required": ["currency", "expiry"],
            },
        ),
    ]


@app.call_tool()
async def call_tool(name: str, arguments: Any) -> list[TextContent]:
    """Handle tool calls."""
    global client

    # Initialize client if needed
    if client is None:
        client = DeribitClient()

    try:
        if name == "get_ticker":
            result = await client.get_ticker(arguments["instrument_name"])
        elif name == "get_order_book":
            result = await client.get_order_book(
                arguments["instrument_name"],
                arguments.get("depth")
            )
        elif name == "get_instruments":
            result = await client.get_instruments(
                arguments["currency"],
                arguments.get("kind"),
                arguments.get("expired", False)
            )
        elif name == "get_last_trades":
            result = await client.get_last_trades_by_instrument(
                arguments["instrument_name"],
                arguments.get("count"),
                arguments.get("include_old", False)
            )
        elif name == "get_currencies":
            result = await client.get_currencies()
        elif name == "get_index_price":
            result = await client.get_index_price(arguments["index_name"])
        elif name == "get_options_chain":
            result = await client.get_options_chain(
                arguments["currency"],
                arguments["expiry"],
                arguments.get("min_strike"),
                arguments.get("max_strike")
            )
            # Return CSV directly as text (not JSON)
            return [TextContent(type="text", text=result)]
        else:
            raise ValueError(f"Unknown tool: {name}")

        # Format the result as JSON
        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    except Exception as e:
        return [TextContent(type="text", text=f"Error: {str(e)}")]


async def main():
    """Run the MCP server."""
    from mcp.server.stdio import stdio_server

    async with stdio_server() as (read_stream, write_stream):
        await app.run(
            read_stream,
            write_stream,
            app.create_initialization_options()
        )


def run():
    """Synchronous entry point."""
    import asyncio
    asyncio.run(main())


if __name__ == "__main__":
    run()
