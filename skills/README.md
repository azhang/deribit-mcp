# Skills

## `deribit/`

`deribit/` is the public Deribit skill: tool selection, instrument naming and units, safety rules for account tools, analysis recipes, and scripts that work without an MCP server. It follows the open `SKILL.md` format.

In Claude Code, the `deribit` plugin installs this skill together with the hosted MCP server: `/plugin install deribit --marketplace azhang/deribit-mcp`. The marketplace is `.claude-plugin/marketplace.json` at the repo root.

To install only the skill, copy or symlink the folder:

| Host | Location |
|---|---|
| Claude Code | `~/.claude/skills/deribit` (all projects) or `.claude/skills/deribit` (one project) |
| Codex | `~/.codex/skills/deribit` or `.codex/skills/deribit` |
| Hermes | See [Hermes](#hermes) below |

The scripts need Node 22+ (or Deno or Bun) and nothing else. `scripts/lib/deribit.mjs` is a generated bundle of [`deribit-client-js`](https://github.com/azhang/deribit-client-js) and `packages/mcp/src/analytics.js`; rebuild it with `npm run build:skill` in `packages/mcp`. CI fails if it's stale.

Keep personal strategies, risk limits and account details in a separate private skill that builds on this one, outside this repo.

## Hermes

[Hermes Agent](https://hermes-agent.nousresearch.com/docs/) has no package that carries a skill and an MCP server together, so set up the parts separately. Each Hermes profile has its own home directory, skills and `config.yaml`; run `hermes` commands with `-p <profile>` for a profile other than the default, and add Deribit only to the profiles that should have it.

### 1. The skill

```bash
hermes skills install azhang/deribit-mcp/skills/deribit
```

Hermes copies `SKILL.md` and the files it mentions (`references/`, `scripts/`) and scans them first. To install by hand instead, copy the whole `skills/deribit/` folder into the profile's skills directory under its `HERMES_HOME` (`~/.hermes` for the default profile), or list a directory that holds it under `skills.external_dirs` in the profile's `config.yaml`.

The scripts need Node 22+ on the machine Hermes runs commands on. They read public data only.

### 2. The MCP server

Pick one entry under `mcp_servers` in the profile's `config.yaml`.

**Market data only** (the hosted server, nothing to install):

```yaml
mcp_servers:
  deribit:
    url: https://mcp.x.zip/deribit/v2/mcp
```

**Your account** (the local server, with your own key). Each `mcp-v<version>` release on GitHub carries the server as one file with no dependencies, which `npx` downloads and runs; the host needs Node 22+. Put the key in the profile's `.env`:

```bash
DERIBIT_CLIENT_ID=…
DERIBIT_CLIENT_SECRET=…
```

Then:

```yaml
mcp_servers:
  deribit:
    command: npx
    args: ["-y", "--allow-remote=root", "https://github.com/azhang/deribit-mcp/releases/download/mcp-v<version>/deribit-mcp-server-<version>.tgz"]
    env:
      DERIBIT_CLIENT_ID: "${DERIBIT_CLIENT_ID}"
      DERIBIT_CLIENT_SECRET: "${DERIBIT_CLIENT_SECRET}"
      DERIBIT_ENV: production
      DERIBIT_OUTPUT_DIR: /path/to/deribit-data   # where save_to writes CSVs; use an absolute path
    tools:
      exclude: [cancel_orders, deribit_call_write]
```

`--allow-remote=root` is needed on npm 12, which refuses to install from a URL by default; older npm ignores it.

If the key isn't in the profile's `.env` yet, an unset `${VAR}` reaches the server as literal text. From `mcp-v2.0.0-alpha.1` the server treats that as no key, logs a warning and serves public data only; `mcp-v2.0.0-alpha.0` takes it for a key and Deribit then rejects even public calls, so with that release leave the two key lines out until the key is set.

The dashboard's "Add MCP server" form takes the same command, args and environment. To update, change `<version>` in both places. Without network access at startup, build the file yourself instead (`npm run build:stdio` in `packages/mcp`) and use `command: node` with `args: [/path/to/deribit-mcp.mjs]`.

- Hermes passes a stdio server only the variables in its `env` block (plus `PATH`, `HOME` and a few other basics), so list any other setting you want there too, such as `DERIBIT_LIVE_TTL` or `HTTPS_PROXY`. `${VAR}` reads from the profile's `.env`.
- Without `DERIBIT_OUTPUT_DIR`, CSVs go to `./deribit-data` under whatever directory Hermes starts the server in.
- `tools.exclude` keeps the two write tools away from the model. For read-only access, also give the Deribit API key only read scopes, so Deribit itself refuses anything else.
- Write tools ask for confirmation with an MCP elicitation form, which Hermes shows through its approval prompt. This hasn't been tested with Hermes yet, so try it on testnet (`DERIBIT_ENV: test`, with a test.deribit.com key) before removing the `exclude`.

### 3. Check it

Run `hermes mcp test deribit`, then `/reload-mcp` in a session (a running gateway picks up `config.yaml` changes on its own within about a minute). With Tool Search on, Hermes's default, the Deribit tools sit behind `tool_search` until the model asks for them; there's nothing to configure.
