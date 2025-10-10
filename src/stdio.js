#!/usr/bin/env node
/**
 * Stdio entry point for Deribit MCP Server
 * For use with Claude Desktop - configure in claude_desktop_config.json
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStdioServer } from './server.js';

// Create and start the stdio server
const server = createStdioServer();
const transport = new StdioServerTransport();

await server.connect(transport);
console.error('Deribit MCP stdio server running');