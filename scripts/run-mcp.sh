#!/usr/bin/env bash
# Launch joyjit/vikunja-mcp from a local build (not npm @democratize-technology).
# Used by Cursor, Claude Code, and Hermes on golpark / parkcircus.
#
# Install: install -m 755 scripts/run-mcp.sh ~/.config/vikunja/run-mcp.sh
set -euo pipefail

TOKEN_FILE="${VIKUNJA_TOKEN_FILE:-$HOME/.config/vikunja/token}"
if [[ -s "$TOKEN_FILE" ]]; then
  export VIKUNJA_API_TOKEN
  VIKUNJA_API_TOKEN="$(tr -d '\n' < "$TOKEN_FILE")"
  # Real token: talk to Vikunja directly (skip OneCLI proxy).
  unset HTTP_PROXY HTTPS_PROXY ALL_PROXY \
    http_proxy https_proxy all_proxy NODE_USE_ENV_PROXY || true
elif [[ -n "${VIKUNJA_API_TOKEN:-${VIKUNJA_API_KEY:-}}" ]]; then
  export VIKUNJA_API_TOKEN="${VIKUNJA_API_TOKEN:-$VIKUNJA_API_KEY}"
else
  echo "vikunja-mcp: put a tk_ token in $TOKEN_FILE" \
    "(or set VIKUNJA_API_TOKEN)" >&2
  exit 1
fi

export VIKUNJA_URL="${VIKUNJA_URL:-${VIKUNJA_API_URL:-https://issues.infotune.com/api/v1}}"

if [[ -n "${VIKUNJA_MCP_ROOT:-}" ]]; then
  ROOT="$VIKUNJA_MCP_ROOT"
elif [[ -f /opt/data/vikunja-mcp/dist/index.js ]]; then
  ROOT=/opt/data/vikunja-mcp
else
  ROOT="$HOME/projects/vikunja-mcp"
fi
ENTRY="$ROOT/dist/index.js"
SMOKE="$ROOT/scripts/smoke-dist.sh"

# Prefer nvm's default Node when present (golpark); else PATH node.
# The alias may be partial ("24"), so pick the newest installed match.
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [[ -s "$NVM_DIR/alias/default" ]]; then
  want="$(tr -d 'v\n' < "$NVM_DIR/alias/default")"
  nvm_bin="$(ls -d "$NVM_DIR/versions/node/v${want}"{,.*}/bin \
    2>/dev/null | sort -V | tail -1 || true)"
  [[ -n "$nvm_bin" ]] && export PATH="$nvm_bin:$PATH"
fi
NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then
  echo "vikunja-mcp: node not found on PATH" >&2
  exit 1
fi

newest_mtime() {
  find "$1" -type f -printf '%T@\n' 2>/dev/null \
    | sort -rn | head -1 | cut -d. -f1
}

dist_is_stale() {
  [[ -d "$ROOT/src" && -d "$ROOT/dist" ]] || return 1
  local src_t dist_t
  src_t="$(newest_mtime "$ROOT/src")"
  dist_t="$(newest_mtime "$ROOT/dist")"
  [[ -n "$src_t" && -n "$dist_t" ]] && ((src_t > dist_t))
}

run_build() {
  echo "vikunja-mcp: building $ROOT..." >&2
  if ! (cd "$ROOT" && npm run build); then
    echo "vikunja-mcp: build failed — fix errors in $ROOT" >&2
    exit 1
  fi
}

ensure_dist() {
  if [[ ! -f "$ENTRY" ]]; then
    echo "vikunja-mcp: missing $ENTRY" >&2
    run_build
  elif dist_is_stale; then
    echo "vikunja-mcp: dist/ is older than src/ (stale build)" >&2
    run_build
  fi
}

verify_dist() {
  [[ -x "$SMOKE" ]] || return 0
  if "$SMOKE"; then
    return 0
  fi
  echo "vikunja-mcp: smoke test failed — rebuilding once..." >&2
  run_build
  "$SMOKE" || {
    echo "vikunja-mcp: dist/ still broken after rebuild" >&2
    exit 1
  }
}

ensure_dist
verify_dist

exec "$NODE" "$ENTRY"
