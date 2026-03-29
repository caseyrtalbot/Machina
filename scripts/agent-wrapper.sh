#!/bin/bash
set -uo pipefail

# agent-wrapper.sh — Bridges Claude Code to the Thought Engine sidecar convention.
# Usage: agent-wrapper.sh --session-id <id> --vault-root <path> --cwd <path>
#                         [--prompt <text>] [--no-cleanup]

SESSION_ID=""
VAULT_ROOT=""
CWD=""
PROMPT=""
NO_CLEANUP=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --session-id)  SESSION_ID="$2";  shift 2 ;;
    --vault-root)  VAULT_ROOT="$2";  shift 2 ;;
    --cwd)         CWD="$2";         shift 2 ;;
    --prompt)      PROMPT="$2";      shift 2 ;;
    --no-cleanup)  NO_CLEANUP=true;  shift ;;
    *)             echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

# Validate required arguments
if [[ -z "$SESSION_ID" ]]; then
  echo "Error: --session-id is required" >&2
  exit 1
fi
if [[ -z "$VAULT_ROOT" ]]; then
  echo "Error: --vault-root is required" >&2
  exit 1
fi
if [[ -z "$CWD" ]]; then
  echo "Error: --cwd is required" >&2
  exit 1
fi

# Sidecar paths
AGENTS_DIR="${VAULT_ROOT}/.te/agents"
SIDECAR_PATH="${AGENTS_DIR}/${SESSION_ID}.json"
mkdir -p "$AGENTS_DIR"

# Write sidecar JSON to disk
write_sidecar() {
  local status="$1"
  local exit_code="${2:-}"
  local error_msg="${3:-}"
  local files_touched="${4:-[]}"

  local json="{
  \"filesTouched\": ${files_touched},
  \"currentTask\": \"Starting...\",
  \"agentType\": \"claude-code\",
  \"status\": \"${status}\",
  \"startedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
  \"pid\": $$"

  if [[ -n "$exit_code" ]]; then
    json="${json},
  \"exitCode\": ${exit_code}"
  fi
  if [[ -n "$error_msg" ]]; then
    # JSON-escape backslashes and double quotes in error messages
    error_msg="${error_msg//\\/\\\\}"
    error_msg="${error_msg//\"/\\\"}"
    json="${json},
  \"error\": \"${error_msg}\""
  fi

  json="${json}
}"
  printf '%s\n' "$json" > "$SIDECAR_PATH"
}

# Collect changed files via git status --short
collect_files_touched() {
  local files_json="["
  local first=true
  if command -v git &>/dev/null && [[ -d "${CWD}/.git" ]]; then
    while IFS= read -r line; do
      local file="${line:3}"
      if [[ -n "$file" ]]; then
        # JSON-escape backslashes and double quotes in filenames
        file="${file//\\/\\\\}"
        file="${file//\"/\\\"}"
        [[ "$first" == "true" ]] && first=false || files_json="${files_json},"
        files_json="${files_json}\"${file}\""
      fi
    done < <(cd "$CWD" && git status --short 2>/dev/null || true)
  fi
  files_json="${files_json}]"
  printf '%s' "$files_json"
}

# Cleanup: collect final filesTouched, write status, optionally remove sidecar
cleanup() {
  local code="${1:-0}"
  local files
  files="$(collect_files_touched)"
  write_sidecar "completed" "$code" "" "$files"
  if [[ "$NO_CLEANUP" == "false" ]]; then
    rm -f "$SIDECAR_PATH"
  fi
}

# Check claude is available
if ! command -v claude &>/dev/null; then
  write_sidecar "error" "" "claude CLI not found on PATH"
  exit 0
fi

# Signal handler: update sidecar before dying
trap 'cleanup 130; exit 130' INT
trap 'cleanup 143; exit 143' TERM

# Write initial sidecar and launch claude
write_sidecar "running"

CLAUDE_ARGS=("--print")
if [[ -n "$PROMPT" ]]; then
  CLAUDE_ARGS+=("$PROMPT")
fi

# Launch claude in the specified working directory
CLAUDE_EXIT=0
(cd "$CWD" && claude "${CLAUDE_ARGS[@]}") || CLAUDE_EXIT=$?

# Clean exit: collect files, write final status, clean up
cleanup "$CLAUDE_EXIT"
exit 0
