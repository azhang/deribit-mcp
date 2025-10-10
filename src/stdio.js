#!/usr/bin/env node
/**
 * Stdio entry point for Deribit MCP Server
 * Run with: node src/stdio.js OR npm run stdio
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStdioServer } from './server.js';

// Create and start the stdio server
const server = createStdioServer();
const transport = new StdioServerTransport();

await server.connect(transport);
console.error('Deribit MCP stdio server running');