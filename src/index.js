/**
 * Cloudflare Workers entry point for Deribit MCP Server
 * Deployed with: npm run dev (local) or npm run deploy (production)
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DeribitClient } from './deribit.js';
import { registerDeribitTools, registerPrivateTools } from './server.js';
import { encode } from '@toon-format/toon';
import { isAuthorized } from './auth.js';

/**
 * Deribit MCP Agent for Cloudflare Workers
 * Provides tools for accessing both public and private Deribit API endpoints
 */
export class DeribitMCP extends McpAgent {
  server = new McpServer({
    name: "Deribit Market Data & Trading",
    version: "0.5.0",
    instructions: `Deribit cryptocurrency exchange MCP server for market data and trading.

💡 Authentication:
- Default credentials can be set via environment variables (DERIBIT_CLIENT_ID, DERIBIT_CLIENT_SECRET, DERIBIT_ENVIRONMENT)
- Users can override defaults with 'set_deribit_credentials' tool (persists to their session)
- Without authentication, public endpoints work but have lower rate limits
- Cloudflare Workers share IP addresses, so authenticated requests have much higher rate limits

Get free read-only API keys at: https://www.deribit.com/account/BTC/api`,
  });

  #client = null;

  constructor(ctx, env) {
    super(ctx, env);

    // Load credentials from persistent storage during initialization
    ctx.blockConcurrencyWhile(async () => {
      const credentials = await ctx.storage.get("deribit_credentials");
      if (credentials) {
        this.#client = new DeribitClient(credentials.baseUrl);
        this.#client.clientId = credentials.clientId;
        this.#client.clientSecret = credentials.clientSecret;
      }
    });
  }

  getClient() {
    if (this.#client === null) {
      // Check for default credentials in environment variables
      const defaultClientId = this.env.DERIBIT_CLIENT_ID;
      const defaultClientSecret = this.env.DERIBIT_CLIENT_SECRET;
      const defaultEnv = this.env.DERIBIT_ENVIRONMENT || 'production';

      const baseUrl = defaultEnv === 'production'
        ? 'https://www.deribit.com/api/v2'
        : 'https://test.deribit.com/api/v2';

      // Initialize client with default credentials if available
      this.#client = new DeribitClient(
        baseUrl,
        defaultClientId || null,
        defaultClientSecret || null
      );
    }
    return this.#client;
  }

  async init() {
    // Always register public tools
    registerDeribitTools(this.server, () => this.getClient());

    // Always register private tools (they handle auth internally)
    registerPrivateTools(this.server, () => this.getClient(), this.ctx);

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
            text: encode({
              authenticated: hasCredentials,
              environment,
              hasCredentials,
              note: hasCredentials ? "Ready for private API operations using Basic Auth" : "Use 'set_deribit_credentials' tool to authenticate"
            })
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
  "Access-Control-Allow-Headers": "Content-Type, mcp-session-id, x-api-key",
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
    if (url.pathname === "/deribit/mcp") {
      if (!(await isAuthorized(request, env))) {
        return new Response("Unauthorized", {
          status: 401,
          headers: { "Content-Type": "text/plain", ...CORS_HEADERS },
        });
      }

      const response = await DeribitMCP.serve("/deribit/mcp").fetch(request, env, ctx);

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

    return new Response("Deribit MCP Server - use /deribit/mcp endpoint", {
      status: 404,
      headers: {
        "Content-Type": "text/plain",
        ...CORS_HEADERS
      }
    });
  },
};