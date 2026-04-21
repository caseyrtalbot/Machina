export interface BuildActionLaunchScriptArgs {
  readonly actionName: string
  readonly scopeSummary: string
  readonly promptPath: string
  readonly scriptPath: string
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildActionLaunchScript({
  actionName,
  scopeSummary,
  promptPath,
  scriptPath
}: BuildActionLaunchScriptArgs): string {
  // No `clear` at the top: keeping the bash command line and the launch
  // banner visible is the only signal the user has that anything is happening
  // during Claude's multi-second session-start hooks. Without it the card
  // looks dead until the first token streams back.
  return [
    '#!/bin/bash',
    'set -u',
    `PROMPT_PATH=${shellQuote(promptPath)}`,
    `SCRIPT_PATH=${shellQuote(scriptPath)}`,
    'cleanup() {',
    '  rm -f "$PROMPT_PATH" "$SCRIPT_PATH"',
    '}',
    'trap cleanup EXIT',
    `printf '\\033[1m▸ Launching %s\\033[0m  (%s)\\n' ${shellQuote(actionName)} ${shellQuote(scopeSummary)}`,
    `printf '  Starting Claude — first output may take a few seconds...\\n\\n'`,
    'claude --append-system-prompt "$(cat "$PROMPT_PATH")" \\',
    '  --dangerously-skip-permissions \\',
    '  --allowed-tools Read,Write,Edit,Glob,Grep,Bash \\',
    '  "Begin."',
    'status=$?',
    'if [ "$status" -ne 0 ]; then',
    `  printf '\\n\\033[31m✗ %s exited with code %d\\033[0m\\n' ${shellQuote(actionName)} "$status"`,
    'fi',
    'exit "$status"'
  ].join('\n')
}
