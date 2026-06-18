#!/usr/bin/env bash
#
# log-event.sh — Claude Code hook helper for the Claude Progress Dashboard.
#
# Appends one JSON line describing a hook event to a per-session JSONL file at
# ~/.claude/dashboard/events/<sessionId>.jsonl. The dashboard extension reads
# and tails these files.
#
# Usage (from a Claude Code hook):
#   ~/.claude/dashboard/log-event.sh <EventName>
#
# Claude Code provides hook context on stdin as JSON and/or via environment
# variables. We read both and prefer whichever is present.

set -u

EVENT_NAME="${1:-Unknown}"

DASHBOARD_DIR="${CLAUDE_DASHBOARD_DIR:-$HOME/.claude/dashboard}"
EVENTS_DIR="$DASHBOARD_DIR/events"
mkdir -p "$EVENTS_DIR"

# Read stdin (hook payload) if any is piped in, without blocking when absent.
STDIN_JSON=""
if [ ! -t 0 ]; then
  STDIN_JSON="$(cat 2>/dev/null || true)"
fi

# Pull a string field out of the stdin JSON using jq when available.
json_field() {
  local key="$1"
  if [ -n "$STDIN_JSON" ] && command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$key" 'getpath($k | split(".")) // empty' <<<"$STDIN_JSON" 2>/dev/null
  fi
}

SESSION_ID="${CLAUDE_SESSION_ID:-}"
[ -z "$SESSION_ID" ] && SESSION_ID="$(json_field session_id)"
[ -z "$SESSION_ID" ] && SESSION_ID="unknown"

CWD="${CLAUDE_PROJECT_DIR:-}"
[ -z "$CWD" ] && CWD="$(json_field cwd)"
[ -z "$CWD" ] && CWD="$PWD"

TOOL="${CLAUDE_TOOL_NAME:-}"
[ -z "$TOOL" ] && TOOL="$(json_field tool_name)"

TS="$(date +%s)"

# Build a one-line JSON object. Prefer jq for safe escaping; fall back to a
# minimal hand-rolled encoder if jq is unavailable.
OUT_FILE="$EVENTS_DIR/$SESSION_ID.jsonl"

if command -v jq >/dev/null 2>&1; then
  jq -cn \
    --arg event "$EVENT_NAME" \
    --arg sessionId "$SESSION_ID" \
    --argjson ts "$TS" \
    --arg cwd "$CWD" \
    --arg tool "$TOOL" \
    '{event:$event, sessionId:$sessionId, ts:$ts, cwd:$cwd}
       + (if $tool != "" then {tool:$tool} else {} end)' \
    >>"$OUT_FILE"
else
  esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
  line="{\"event\":\"$(esc "$EVENT_NAME")\",\"sessionId\":\"$(esc "$SESSION_ID")\",\"ts\":$TS,\"cwd\":\"$(esc "$CWD")\""
  if [ -n "$TOOL" ]; then
    line="$line,\"tool\":\"$(esc "$TOOL")\""
  fi
  line="$line}"
  printf '%s\n' "$line" >>"$OUT_FILE"
fi

# Never block Claude Code: always succeed.
exit 0
