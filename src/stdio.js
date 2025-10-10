#!/usr/bin/env node
/**
 * Local stdio server for testing with MCP clients
 * Run with: node src/stdio.js
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStdioServer } from './server.js';

// Create the server instance
const server = createStdioServer();

// Start stdio server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Deribit MCP stdio server running');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});