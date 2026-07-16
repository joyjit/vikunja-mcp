# MCP Integration CI

Live tests against a **real Vikunja** in ephemeral Docker. Unit/coverage CI
(`.github/workflows/ci.yml`) stays mocked; this gate catches API drift.

## Pattern (same idea as mini-mealie’s Mealie E2E)

1. `docker/vikunja.e2e.yml` — pinned Vikunja (`2.3.0`), SQLite on tmpfs.
2. `scripts/vikunja-docker.ts` — `up` / `down`: wait for health, register a
   user, mint a JWT via login, write `.env.e2e` (**no secrets**).
3. `scripts/test-mcp.ts` — loads `.env.e2e` if present; runs the suite.
4. `.github/workflows/mcp-integration.yml` — `npm run test:mcp` on every PR.

## Commands

Full cycle (up → test → down):

```
npm run test:mcp
```

Manual control:

```
npm run test:mcp:up
npm run test:mcp:run
npm run test:mcp:down
```

Point at any Vikunja instead of Docker (env wins over `.env.e2e`):

```
export VIKUNJA_URL=https://example.com/api/v1
export VIKUNJA_API_TOKEN=tk_...
npm run test:mcp:run
```

## Useful env vars

| Var | Default | Purpose |
| --- | --- | --- |
| `VIKUNJA_URL` / `VIKUNJA_API_TOKEN` | from `.env.e2e` | Target instance |
| `VIKUNJA_IMAGE` | `vikunja/vikunja:2.3.0` | Docker image (pin for a stable gate) |
| `VIKUNJA_PORT` | `3456` | Host port for the container |

## CI notes

- Docker + Compose ship on `ubuntu-latest`.
- Pinned image so a red PR means *your* change broke, not an upstream release.
- Existing lint / typecheck / coverage job is unchanged.
