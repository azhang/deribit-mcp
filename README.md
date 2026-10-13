# Deribit MCP

Deribit market data and account tools for AI agents: an MCP server ([`packages/mcp`](packages/mcp)) and the `deribit` skill, packaged as a plugin in [`plugins/deribit`](plugins/deribit).

The hosted server at `https://mcp.x.zip/deribit/v2/mcp` serves public data. Run the server locally with your own API key for account tools.

## Claude Code

```
/plugin install deribit --marketplace azhang/deribit-mcp
```

Or in a shell: `claude plugin marketplace add azhang/deribit-mcp && claude plugin install deribit@deribit-mcp`. Claude Code sessions opened in this repo install it automatically (`.claude/settings.json`).

## Other hosts

[`plugins/README.md`](plugins/README.md) covers Hermes, Codex, other Agent Plugins clients, and the local server.

## v1

The original server (repo root `src/`, Cloudflare Worker `deribit-mcp`) was removed. Its last version is at the [`v1`](https://github.com/azhang/deribit-mcp/tree/v1) tag.

## License

MIT
