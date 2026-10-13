# Skills

## `deribit/`

`deribit/` is the public Deribit skill: tool selection, instrument naming and units, safety rules for account tools, analysis recipes, and scripts that work without an MCP server. It follows the open `SKILL.md` format.

In Claude Code, the `deribit` plugin installs this skill together with the hosted MCP server: `/plugin install deribit --marketplace azhang/deribit-mcp`. The marketplace is `.claude-plugin/marketplace.json` at the repo root.

To install only the skill, copy or symlink the folder:

| Host | Location |
|---|---|
| Claude Code | `~/.claude/skills/deribit` (all projects) or `.claude/skills/deribit` (one project) |
| Codex | `~/.codex/skills/deribit` or `.codex/skills/deribit` |
| Hermes | Add this repo as a skill source, or copy the folder into Hermes's skills directory |

The scripts need Node 22+ (or Deno or Bun) and nothing else. `scripts/lib/deribit.mjs` is a generated bundle of [`deribit-client-js`](https://github.com/azhang/deribit-client-js) and `packages/mcp/src/analytics.js`; rebuild it with `npm run build:skill` in `packages/mcp`. CI fails if it's stale.

Keep personal strategies, risk limits and account details in a separate private skill that builds on this one, outside this repo.
