/**
 * Cloudflare Workers entry point for Deribit MCP Server
 * Deployed with: npm run dev (local) or npm run deploy (production)
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DeribitClient } from './deribit.js';
import { registerDeribitTools } from './server.js';

/**
 * Deribit MCP Agent for Cloudflare Workers
 * Provides tools for accessing Deribit's public API endpoints
 */
export class DeribitMCP extends McpAgent {
  server = new McpServer({
    name: "Deribit Market Data",
    version: "0.4.0",
  });

  #client = null;

  getClient() {
    if (this.#client === null) {
      this.#client = new DeribitClient();
    }
    return this.#client;
  }

  async init() {
    // Register all Deribit tools using shared registration function
    registerDeribitTools(this.server, () => this.getClient());
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