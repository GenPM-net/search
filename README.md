# @core/search

[![genpm](https://api.genpm.net/v1/badge/@core/search.svg)](https://genpm.net/p/@core/search) ![license](https://img.shields.io/badge/license-MIT-blue)

> Site search on Postgres full-text: per-language stemming, prefix matching, safe snippets and typo fallback

A [GenPM](https://genpm.net) module: **source code + AI rules + MCP config**, injected into your project instead of hidden in `node_modules`. The code lands in `src/lib/search`, pinned to a verified commit, and you own it.

## Install

```bash
genpm add @core/search
```

No genpm yet? `curl -fsSL https://genpm.net/install.sh | sh` (macOS/Linux), `irm https://genpm.net/install.ps1 | iex` (Windows), or one-off with `npx @genpm-net/cli add @core/search`.

Or let your AI agent do it: run `genpm mcp setup` once, then ask *"add @core/search with genpm"* in Claude Code, Cursor, VS Code, Windsurf, Codex or Gemini CLI. It shows you a dry-run plan before writing anything.

## What it does

Site search on Postgres full-text search: one `search_documents` table fed by any `SearchSource` (@core/contracts),
weighted title/body vectors with the stemmer of each document's language, prefix matching for search-as-you-type,
snippets returned as plain parts (never HTML) and, if the `pg_trgm` extension exists, a typo-tolerant fallback on
titles. No external engine, no semantic search.

## At a glance

- **GenPM dependencies** (installed with it): [@core/db](https://genpm.net/p/@core/db), [@core/jobs](https://genpm.net/p/@core/jobs), [@core/contracts](https://genpm.net/p/@core/contracts)
- **npm dependencies** (proposed, never installed without asking): `zod`
- **AI rules**: [`AGENTS.md`](AGENTS.md), loaded by your agent only when it works in `src/lib/search`

## Security

GenPM installs a 40-character commit SHA (never a branch), verifies an Ed25519-signed manifest, never runs install scripts and scans AI rules for prompt injection. Details: [genpm.net/docs/security](https://genpm.net/docs/security).

## License

MIT — see [LICENSE](LICENSE). Browse the full catalog at [genpm.net](https://genpm.net).
