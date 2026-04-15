export interface BuildActionLaunchScriptArgs {
  readonly actionName: string
  readonly scopeSummary: string
  readonly promptPath: string
  readonly scriptPath: string
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function buildActionLaunchScript({
  actionName,
  scopeSummary,
  promptPath,
  scriptPath
}: BuildActionLaunchScriptArgs): string {
  return [
    '#!/bin/bash',
    'set -u',
    'clear',
    `PROMPT_PATH=${shellQuote(promptPath)}`,
    `SCRIPT_PATH=${shellQuote(scriptPath)}`,
    'cleanup() {',
    '  rm -f "$PROMPT_PATH" "$SCRIPT_PATH"',
    '}',
    'trap cleanup EXIT',
    `printf '\\033[1m%s\\033[0m  %s\\n\\n' ${shellQuote(actionName)} ${shellQuote(scopeSummary)}`,
    'claude --append-system-prompt "$(cat "$PROMPT_PATH")" \\',
    '  --dangerously-skip-permissions \\',
    '  --allowed-tools Read,Write,Edit,Glob,Grep,Bash \\',
    '  "Begin."',
    'exit "$?"'
  ].join('\n')
}
