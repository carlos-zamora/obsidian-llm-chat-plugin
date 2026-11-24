# CLAUDE.md

LLM Sessions: an Obsidian plugin that embeds Claude chats in notes as collapsible callouts, running the user's own Claude Code through `@anthropic-ai/claude-agent-sdk`.

- **Design source of truth:** `docs/ARCHITECTURE.md`. Update it when a design decision changes.
- **What the SDK actually does:** `docs/SPIKES.md` (verified behavior; read before changing runtime options).
- **Obsidian plugin conventions** (manifest, releases, UI copy, lint): `AGENTS.md`.

## Commands

```bash
npm run dev     # esbuild watch → main.js
npm run build   # tsc typecheck + production bundle
npm run lint    # eslint with eslint-plugin-obsidianmd
npm test        # vitest (pure modules only)
```

This repo sits inside a live vault (`.obsidian/plugins/obsidian-llm-chat-plugin`). A build replaces the `main.js` that Obsidian loads, so reload the plugin to test.

## Layout

| Folder | Holds |
|---|---|
| `src/main.ts` | Wiring and lifecycle only. |
| `src/core/` | Chat records and the index (`chat-store`, `chat-index`, `chat-folders`), orchestration (`chat-service`), context and transcripts, note rename/move/delete handling, protocol handler. `*-format.ts`, `context-builder.ts` and `note-moves.ts` are pure and tested. |
| `src/runtime/` | `AgentRuntime` seam; `claude/` holds SDK options, the warm-process pool, summaries and session mirroring. |
| `src/tools/` | Vault MCP server and `VaultAccess` (exclusions, vault boundary). |
| `src/embed/` | Callout format (pure, tested), post-processor, and the updater that rewrites callouts. |
| `src/onboarding/`, `src/settings/`, `src/ui/`, `src/commands/`, `src/handoff/` | What their names say. |
| `tests/` | vitest specs for the pure modules. |

## Rules that must hold

- **Never handle Claude.ai credentials.** No login screen, token field or `setup-token`. Users sign in to Claude Code itself.
- **Subscription mode strips `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`** from the subprocess env (`runtime/claude/claude-env.ts`). An API key lives only in Obsidian SecretStorage, never in `data.json`.
- **Every query goes through `baseOptions()`**: `settingSources: []` by default, `strictMcpConfig: true`, and `settings.disableClaudeAiConnectors: true`. Without the last two, the user's claude.ai connectors (Gmail and others) attach to note chats.
- **The agent reaches files only through the vault MCP tools.** Built-in tools stay off (`tools: []`), and `canUseTool` denies everything else.
- **Never parse Claude Code session `.jsonl` files.** Read conversations with `getSessionMessages`; the vault mirror is a byte copy.
- **All chat-folder I/O goes through `vault.adapter`.** Hidden folders have no `TFile` and fire no vault events.
- **Command IDs (`new-chat`, `open-chat`) and the manifest `id` (`llm-sessions`) are stable.**
- Take SDK option and function names from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, not from memory, and record new findings in `docs/SPIKES.md`.

## Testing against Claude Code

Unit tests cover the pure modules. For runtime changes, bundle a small Node harness that imports the runtime modules (they have no `obsidian` imports) and run it against the real `claude` binary with `model: 'haiku'`, `effort: 'low'`. Keep scripts in a scratch folder, not the repo. UI behavior needs a manual check in Obsidian.

**Obsidian runs plugins in Electron's renderer, not plain Node.** Globals such as `AbortController` are Chromium's, and some Node APIs reject them. In a harness, replace `globalThis.AbortController` with a non-Node implementation and apply the same esbuild `alias` as `esbuild.config.mjs`. Also make the global timers return numbers with no `.unref`, as browser timers do. Keep the `events` alias (`src/shims/node-events.ts`) and the timers `inject` (`src/shims/node-timers.ts`); without them every query fails in Obsidian (see `docs/SPIKES.md`). Plugin code uses `window.setTimeout` for browser timers.
