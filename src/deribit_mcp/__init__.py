"""Deribit MCP Server - Access Deribit public API via MCP."""

import asyncio
from .server import main as async_main


def main():
    """Entry point for the MCP server."""
    asyncio.run(async_main())


__all__ = ["main"]
