"""Cloudflare Worker entry point for Deribit MCP server."""

from deribit_mcp.server import mcp

# Get the ASGI app from FastMCP
app = mcp.asgi_app()


async def on_fetch(request, env):
    """Main entry point for the Worker."""
    # Handle the request directly with the ASGI app
    import asgi
    return await asgi.fetch(app, request, env)