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

// Worker fetch handler
export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);

    // HTTP endpoint for MCP protocol (streamable HTTP transport)
    if (url.pathname === "/mcp") {
      return DeribitMCP.serve("/mcp").fetch(request, env, ctx);
    }

    return new Response("Deribit MCP Server - use /mcp endpoint", {
      status: 404,
      headers: { "Content-Type": "text/plain" }
    });
  },
};