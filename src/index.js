/**
 * Cloudflare Workers entry point for Deribit MCP Server
 * Deployed with: npm run dev (local) or npm run deploy (production)
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DeribitClient } from './deribit.js';
import { registerDeribitTools, registerPrivateTools } from './server.js';

/**
 * Deribit MCP Agent for Cloudflare Workers
 * Provides tools for accessing both public and private Deribit API endpoints
 */
export class DeribitMCP extends McpAgent {
  server = new McpServer({
    name: "Deribit Market Data & Trading",
    version: "0.5.0",
    instructions: `Deribit cryptocurrency exchange MCP server for market data and trading.

💡 TIP: If you get rate limit errors, use 'set_deribit_credentials' to authenticate.
Cloudflare Workers share IP addresses, so authenticated requests have much higher rate limits.
Get free read-only API keys at: https://www.deribit.com/account/BTC/api`,
  });

  #client = null;

  getClient() {
    if (this.#client === null) {
      // Start with public API client (default to test environment)
      this.#client = new DeribitClient('https://test.deribit.com/api/v2');
    }
    return this.#client;
  }

  async init() {
    // Always register public tools
    registerDeribitTools(this.server, () => this.getClient());

    // Always register private tools (they handle auth internally)
    registerPrivateTools(this.server, () => this.getClient());

    // Add a tool to check authentication status
    this.server.registerTool(
      'get_auth_status',
      {
        description: 'Check if the MCP server is authenticated with Deribit',
        inputSchema: {}
      },
      async () => {
        const client = this.getClient();
        const hasCredentials = !!(client.clientId && client.clientSecret);
        const environment = client.baseUrl.includes('test.deribit.com') ? 'test' :
                           client.baseUrl.includes('www.deribit.com') ? 'production' : 'unknown';

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              authenticated: hasCredentials,
              environment,
              hasCredentials,
              tokenValid: client.tokenExpiry ? client.tokenExpiry > Date.now() : false,
              note: hasCredentials ? "Ready for private API operations" : "Use 'set_deribit_credentials' tool to authenticate"
            }, null, 2)
          }],
        };
      }
    );
  }
}

// CORS headers for browser-based MCP clients
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, mcp-session-id",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

// Worker fetch handler
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS,
      });
    }

    // HTTP endpoint for MCP protocol (streamable HTTP transport)
    if (url.pathname === "/mcp") {
      const response = await DeribitMCP.serve("/mcp").fetch(request, env, ctx);

      // Add CORS headers to the response
      const headers = new Headers(response.headers);
      Object.entries(CORS_HEADERS).forEach(([key, value]) => {
        headers.set(key, value);
      });

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    return new Response("Deribit MCP Server - use /mcp endpoint", {
      status: 404,
      headers: {
        "Content-Type": "text/plain",
        ...CORS_HEADERS
      }
    });
  },
};