import { describe, expect, it } from 'vitest'
import { buildActionLaunchScript } from '../action-launcher'

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
