# Changelog

## 0.3.0 — 2026-07-18

Republish after npm package delete + GitHub release cleanup. First clean release with working CI publish token (bypass 2FA, empty IP allowlist).

## 0.2.9 — 2026-07-17

Fix Release npm auth by overwriting setup-node userconfig (empty token line was winning).

## 0.2.8 — 2026-07-17

Fix Release workflow: write npm auth into setup-node's userconfig (not project `.npmrc`).

## 0.2.7 — 2026-07-17

Confirm Release workflow npm publish (scope + public access + refreshed `NPM_TOKEN`).

## 0.2.6 — 2026-07-17

Verify GitHub Release → npm publish with the corrected `NPM_TOKEN` secret (0.2.5 was published manually after the Action token failed).

## 0.2.5 — 2026-07-17

Republish via GitHub Release so the automated npm publish job completes successfully (0.2.4 is already on the registry; recreating that release could not overwrite it).

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
