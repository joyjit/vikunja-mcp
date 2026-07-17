# Changelog

## 0.2.4 — 2026-07-17

Republish to fix broken npm package metadata (0.2.3 was not installable via `npm`/`npx` despite existing on the registry).

## 0.2.3 — 2026-07-17

First release of the **`@joyjit/vikunja-mcp`** soft fork (based on democratize-technology/vikunja-mcp).

### Fixes

- Stop HTML-encoding strings before Vikunja JSON API calls (titles/descriptions stay raw; HTML bodies work)
- Narrow SQL-keyword rejects that false-positived on ordinary titles like "Create…"
- `bulk-update` merges per task so unrelated fields are not wiped
- Task `update` honors `projectId` (move) and applies labels on create
- Project partial `update` preserves title and `parent_project_id` when omitted

### Platform

- Require Node.js 24+ (Active LTS)
- Dockerized MCP integration CI against Vikunja 2.3; weekly canary + Dependabot on the fork

### Notes

- Package renamed from `@democratize-technology/vikunja-mcp` → `@joyjit/vikunja-mcp`
- Upstream PRs remain open where applicable; prefer upstream once equivalent fixes ship there
