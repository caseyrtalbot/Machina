import { describe, expect, it } from 'vitest'
import { buildActionLaunchScript, shellQuote } from '../action-launcher'

describe('buildActionLaunchScript', () => {
  it('builds a Claude Code action launcher with a supported positional prompt', () => {
    const script = buildActionLaunchScript({
      actionName: 'Librarian',
      scopeSummary: 'entire vault',
      promptPath: '/vault/.machina-dev/action-prompt-abc.txt',
      scriptPath: '/vault/.machina-dev/action-launch-abc.sh'
    })

    expect(script).toContain('--append-system-prompt')
    expect(script).toContain('--dangerously-skip-permissions')
    expect(script).toContain('--allowed-tools Read,Write,Edit,Glob,Grep,Bash')
    expect(script).toContain('"Begin."')
    expect(script).not.toContain('--initial-prompt')
    expect(script).toContain('Librarian')
    expect(script).toContain('entire vault')
  })

  // Regression guard: without --print, Claude v2.1+ boots into interactive
  // REPL mode and the positional "Begin." pre-fills the prompt box instead
  // of auto-submitting. The user sees a `>` cursor waiting for input and
  // thinks nothing is happening.
  it('runs Claude in --print mode so the agent executes non-interactively', () => {
    const script = buildActionLaunchScript({
      actionName: 'Librarian',
      scopeSummary: 'entire vault',
      promptPath: '/vault/.machina-dev/action-prompt-abc.txt',
      scriptPath: '/vault/.machina-dev/action-launch-abc.sh'
    })

    expect(script).toMatch(/claude --print/)
  })

  // Regression guard: the terminal card looks dead during Claude's
  // session-start hooks (~3s of silent output). Removing `clear` and
  // printing a launch banner is what gives the user visible feedback.
  it('emits a visible launch banner and no `clear` so the user sees activity', () => {
    const script = buildActionLaunchScript({
      actionName: 'Librarian',
      scopeSummary: 'entire vault',
      promptPath: '/vault/.machina-dev/action-prompt-abc.txt',
      scriptPath: '/vault/.machina-dev/action-launch-abc.sh'
    })

    expect(script).not.toMatch(/^clear$/m)
    expect(script).toContain('Launching')
    expect(script).toContain('first tokens may take a few seconds')
  })

  it('surfaces a non-zero Claude exit with a red failure line', () => {
    const script = buildActionLaunchScript({
      actionName: 'Librarian',
      scopeSummary: 'entire vault',
      promptPath: '/vault/.machina-dev/action-prompt-abc.txt',
      scriptPath: '/vault/.machina-dev/action-launch-abc.sh'
    })

    expect(script).toContain('status=$?')
    expect(script).toContain('if [ "$status" -ne 0 ]')
    expect(script).toContain('exited with code')
    expect(script).toContain('exit "$status"')
  })

  it('cleans up generated prompt and launch files after Claude exits', () => {
    const script = buildActionLaunchScript({
      actionName: 'Steelman',
      scopeSummary: 'note.md',
      promptPath: "/vault/.machina-dev/action-prompt-quote's.txt",
      scriptPath: "/vault/.machina-dev/action-launch-quote's.sh"
    })

    expect(script).toContain('trap cleanup EXIT')
    expect(script).toContain('rm -f "$PROMPT_PATH" "$SCRIPT_PATH"')
    expect(script).toContain("PROMPT_PATH='/vault/.machina-dev/action-prompt-quote'\\''s.txt'")
    expect(script).toContain("SCRIPT_PATH='/vault/.machina-dev/action-launch-quote'\\''s.sh'")
  })
})

describe('shellQuote', () => {
  it('wraps plain paths in single quotes', () => {
    expect(shellQuote('/vault/.machina/action-launch-abc.sh')).toBe(
      "'/vault/.machina/action-launch-abc.sh'"
    )
  })

  it('escapes apostrophes so bash does not drop into a `quote>` prompt', () => {
    expect(shellQuote("/Users/x/Desktop/Naval's Library/.machina/a.sh")).toBe(
      "'/Users/x/Desktop/Naval'\\''s Library/.machina/a.sh'"
    )
  })
})
