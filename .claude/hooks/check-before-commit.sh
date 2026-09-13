#!/usr/bin/env bash
# Pre-commit safety net: run `bun run check` before any jj/git commit.
# Reads the PreToolUse hook payload from stdin; only fires for commit commands.
# Exit codes:
#   0  → proceed (not a commit command, or check passed)
#   2  → block the tool call and surface stderr to Claude (check failed)

set -u

input=$(cat || true)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null || true)

# Only react to `jj commit` or `git commit` invocations.
if ! printf '%s' "$cmd" | grep -qE '(^|[^[:alnum:]_])(jj|git)[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || {
  echo "pre-commit hook: could not cd into project dir" >&2
  exit 2
}

echo "[pre-commit] running 'bun run check'..." >&2
if bun run check >&2; then
  echo "[pre-commit] check passed" >&2
  exit 0
fi

echo "" >&2
echo "[pre-commit] ✗ 'bun run check' failed — fix with 'bun run fmt' (auto-fix) or address lint/type errors before committing." >&2
exit 2
