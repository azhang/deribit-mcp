# Plugins

## `deribit/`

`deribit/` is one plugin directory in two formats:

- **Claude Code:** `.claude-plugin/plugin.json`, listed in the repo's marketplace (`.claude-plugin/marketplace.json` at the repo root). Install with `/plugin install deribit --marketplace azhang/deribit-mcp`.
- **[Agent Plugins 1.0](https://agent-plugins.org):** `plugin.json` and `mcp.json`, read by Hermes, Codex, Cursor, GitHub Copilot and other clients that support the format. Point the client at `azhang/deribit-mcp/plugins/deribit`.

Both install the `deribit` skill and the hosted MCP server (`https://mcp.x.zip/deribit/v2/mcp`, public data). Keep `version` and `description` the same in both manifests.

The skill (`deribit/skills/deribit/`) covers tool selection, instrument naming and units, safety rules for account tools, analysis recipes, and scripts that work without an MCP server. It follows the open `SKILL.md` format. To install only the skill, copy or symlink the folder:

| Host | Location |
|---|---|
| Claude Code | `~/.claude/skills/deribit` (all projects) or `.claude/skills/deribit` (one project) |
| Codex | `~/.codex/skills/deribit` or `.codex/skills/deribit` |
| Hermes | `hermes skills install azhang/deribit-mcp/plugins/deribit/skills/deribit` |

The scripts need Node 22+ (or Deno or Bun) and nothing else. `scripts/lib/deribit.mjs` is a generated bundle of [`deribit-client-js`](https://github.com/azhang/deribit-client-js) and `packages/mcp/src/analytics.js`; rebuild it with `npm run build:skill` in `packages/mcp`. CI fails if it's stale.

Keep personal strategies, risk limits and account details in a separate private skill that builds on this one, outside this repo.

## Hermes

Each [Hermes Agent](https://hermes-agent.nousresearch.com/docs/) profile has its own home directory, plugins, skills and `config.yaml`; run `hermes` commands with `-p <profile>` for a profile other than the default, and add Deribit only to the profiles that should have it.

### 1. The plugin

```bash
hermes -p <profile> plugins install azhang/deribit-mcp/plugins/deribit
```

The dashboard's Plugins page takes the same `azhang/deribit-mcp/plugins/deribit` under "Install from GitHub". It isn't in the Hermes catalog, so Hermes warns that the source is unreviewed and security-scans the plugin before it installs. Enable it when asked (`hermes -p <profile> plugins enable deribit` later): Hermes keeps Agent Plugins packages disabled until you do.

That gives the profile the skill and the hosted server, which is all you need for market data. The skill's name is namespaced (`agent-plugin-deribit-…:deribit`); the agent finds it with `skills_list`, and `hermes skills list` doesn't show it. The scripts need Node 22+ on the machine Hermes runs commands on.

### 2. Your account (optional)

For account tools, run the local server with your own key. A `deribit` entry under `mcp_servers` in the profile's `config.yaml` replaces the plugin's hosted server of the same name. Each `mcp-v<version>` release on GitHub carries the server as one file with no dependencies, which `npx` downloads and runs; the host needs Node 22+. Put the key in the profile's `.env`:

```bash
DERIBIT_CLIENT_ID=…
DERIBIT_CLIENT_SECRET=…
```

Then:

```yaml
mcp_servers:
  deribit:
    command: npx
    args: ["-y", "https://github.com/azhang/deribit-mcp/releases/download/mcp-v<version>/deribit-mcp-server-<version>.tgz"]
    env:
      DERIBIT_CLIENT_ID: "${DERIBIT_CLIENT_ID}"
      DERIBIT_CLIENT_SECRET: "${DERIBIT_CLIENT_SECRET}"
      DERIBIT_ENV: production
      DERIBIT_OUTPUT_DIR: /path/to/deribit-data   # where save_to writes CSVs; use an absolute path
    tools:
      exclude: [cancel_orders, deribit_call_write]
```

The dashboard's "Add MCP server" form takes the same command, args and environment. To update, change `<version>` in both places. Without network access at startup, build the file yourself instead (`npm run build:stdio` in `packages/mcp`) and use `command: node` with `args: [/path/to/deribit-mcp.mjs]`.

- Hermes passes a stdio server only the variables in its `env` block (plus `PATH`, `HOME` and a few other basics), so list any other setting you want there too, such as `DERIBIT_LIVE_TTL` or `HTTPS_PROXY`. `${VAR}` reads from the profile's `.env`.
- Without `DERIBIT_OUTPUT_DIR`, CSVs go to `./deribit-data` under whatever directory Hermes starts the server in.
- `tools.exclude` keeps the two write tools away from the model. For read-only access, also give the Deribit API key only read scopes, so Deribit itself refuses anything else.
- Write tools ask for confirmation with an MCP elicitation form, which Hermes shows through its approval prompt. This hasn't been tested with Hermes yet, so try it on testnet (`DERIBIT_ENV: test`, with a test.deribit.com key) before removing the `exclude`.

### 3. Check it

Run `hermes mcp test deribit`, then `/reload-mcp` in a session (a running gateway picks up `config.yaml` changes on its own within about a minute). With Tool Search on, Hermes's default, the Deribit tools sit behind `tool_search` until the model asks for them; there's nothing to configure.
