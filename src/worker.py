"""Cloudflare Worker entry point for Deribit MCP server."""

from js import Response
from deribit_mcp.server import mcp


class DeribitMCPServer:
    """Durable Object for Deribit MCP server."""

    def __init__(self, state, env):
        self.state = state
        self.env = env
        # Initialize the FastMCP app for HTTP
        self.app = mcp.asgi_app()

    async def fetch(self, request):
        """Handle incoming requests."""
        import asgi
        return await asgi.fetch(self.app, request, self.env, self.state)


async def on_fetch(request, env):
    """Main entry point for the Worker."""
    # Use Durable Object for stateful MCP connections
    id = env.DERIBIT_MCP.idFromName("default")
    stub = env.DERIBIT_MCP.get(id)

    # Forward the request to the Durable Object
    return await stub.fetch(request)