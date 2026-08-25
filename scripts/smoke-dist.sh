#!/usr/bin/env bash
# Prove the built server in dist/ actually starts and speaks MCP.
#
# Why this exists: the server is launched as an MCP stdio subprocess, so a
# crash at import time looks identical to "no tools configured" — the agent
# just silently has no Vikunja tools. That hid a broken dist/ for six days
# (Vikunja #682). This is the gate that makes such a break loud.
#
# Checks, in order:
#   1. dist/ exists and is not older than src/ (stale build)
#   2. the entry point imports without throwing
#   3. an MCP `initialize` request gets a well-formed JSON-RPC reply
#
# Used two ways:
#   npm run build   -> postbuild gate, so a broken dist/ is never produced
#   cron/systemd    -> periodic health check feeding an alert (exit code is
#                      the signal; see docs/ALERTING.md)
#
# Exit 0 = healthy. Non-zero = broken, with the reason on stderr.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENTRY="$ROOT/dist/index.js"
TIMEOUT="${SMOKE_TIMEOUT:-30}"

fail() {
	echo "smoke-dist: FAIL: $*" >&2
	exit 1
}

# --- 1. build present and fresh -------------------------------------------
[[ -f "$ENTRY" ]] || fail "missing $ENTRY — run 'npm run build'"

newest() {
	# Newest mtime (epoch seconds) under a directory, 0 if none.
	find "$1" -type f -printf '%T@\n' 2>/dev/null \
		| sort -rn | head -1 | cut -d. -f1
}
src_t="$(newest "$ROOT/src")"
dist_t="$(newest "$ROOT/dist")"
if [[ -n "$src_t" && -n "$dist_t" ]] && ((src_t > dist_t)); then
	fail "dist/ is older than src/ (stale build) — run 'npm run build'"
fi

# --- 2 & 3. imports, and answers an MCP handshake -------------------------
# A crash on import kills the process before any reply, so one handshake
# covers both. Env is neutralised so this tests the build, not the config:
# a token is not needed to answer `initialize`.
req='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke-dist","version":"0"}}}'

err_file="$(mktemp)"
trap 'rm -f "$err_file"' EXIT

out="$(printf '%s\n' "$req" \
	| env -u VIKUNJA_API_TOKEN -u VIKUNJA_API_KEY -u VIKUNJA_URL \
		timeout "$TIMEOUT" node "$ENTRY" 2>"$err_file")"
rc=$?

if ((rc == 124)); then
	fail "server did not reply to initialize within ${TIMEOUT}s"
fi

# Look for a JSON-RPC reply to our request on stdout. Parsed, not grepped, so
# a server that prints something JSON-ish but wrong still fails.
reply="$(printf '%s' "$out" | node -e '
let buf = "";
process.stdin.on("data", c => buf += c);
process.stdin.on("end", () => {
  for (const line of buf.split("\n")) {
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.jsonrpc === "2.0" && msg.id === 1 && msg.result?.protocolVersion) {
      process.stdout.write(String(msg.result.serverInfo?.name ?? "unknown"));
      return;
    }
  }
})' 2>/dev/null)"

if [[ -z "$reply" ]]; then
	echo "smoke-dist: no valid MCP initialize reply (node exit $rc)" >&2
	echo "--- server stderr (last 20 lines) ---" >&2
	tail -20 "$err_file" >&2
	exit 1
fi

echo "smoke-dist: OK — $reply answered initialize"
