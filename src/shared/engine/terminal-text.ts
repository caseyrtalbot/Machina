/* eslint-disable no-control-regex */
/**
 * Terminal-text cleanup for block rendering.
 *
 * Block.outputText accumulates raw PTY bytes including ANSI CSI, OSC, and
 * various control sequences that xterm.js paints visually but render as
 * literal noise in plain DOM. These helpers strip the noise so block cards
 * can show readable text and lift the first non-empty line as the command.
 *
 * Pure, dependency-free, renderer- and main-safe.
 */

// CSI: ESC [ params intermediates final
const CSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g
// OSC terminated by BEL (\x07)
const OSC_BEL_RE = /\x1b\][^\x07]*\x07/g
// OSC terminated by ST (\x1b\\)
const OSC_ST_RE = /\x1b\][\s\S]*?\x1b\\/g
// SS2/SS3 single-character keypad/function escapes
const SS2_SS3_RE = /\x1b[NO][ -~]/g
// 3-char charset selection (ESC ( B, ESC ) 0, etc.)
const ESC_CHARSET_RE = /\x1b[()*+\-./][\s\S]/g
// Any remaining 2-char ESC sequence (RIS, IND, NEL, etc.)
const ESC_TWOCHAR_RE = /\x1b[\s\S]/g
// Stray C0 controls except TAB (0x09), LF (0x0a), CR (0x0d).
const STRAY_C0_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

export function stripTerminalControls(text: string): string {
  if (text.length === 0) return text
  let out = text
  out = out.replace(OSC_BEL_RE, '')
  out = out.replace(OSC_ST_RE, '')
  out = out.replace(CSI_RE, '')
  out = out.replace(SS2_SS3_RE, '')
  out = out.replace(ESC_CHARSET_RE, '')
  out = out.replace(ESC_TWOCHAR_RE, '')
  out = out.replace(STRAY_C0_RE, '')
  return out
}

// Recognises a shell prompt tail like `% `, `$ `, `# `, or `> `, optionally
// followed by the typed command on the same line. The lookbehind excludes
// percent-completions like `50% done` and dollar amounts like `$5 fee` from
// being misread as a prompt.
const PROMPT_TAIL_RE = /(?<!\d)[%$#>]\s+(\S.*)?\s*$/

/**
 * First non-empty line of (cleaned) text, with any prompt prefix peeled off.
 * Used as a fallback command label when the watcher couldn't capture the
 * command directly (block.command is empty). Returns '' for a bare prompt.
 */
export function extractCommand(cleaned: string): string {
  if (cleaned.length === 0) return ''
  const lines = cleaned.split(/\r?\n/)
  for (const line of lines) {
    if (line.trim().length === 0) continue
    const m = line.match(PROMPT_TAIL_RE)
    if (m) return (m[1] ?? '').trim()
    return line.trim()
  }
  return ''
}

/**
 * If the first non-empty line of (cleaned) text is a shell prompt + command
 * echo, drop it. Returns the remainder. The detector currently captures
 * prompt-redraw bytes between `prompt-start` and `command-start` as output,
 * so for display we want to skip past that header.
 */
export function dropPromptHeader(cleaned: string): string {
  if (cleaned.length === 0) return cleaned
  const lines = cleaned.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().length === 0) continue
    if (PROMPT_TAIL_RE.test(lines[i])) {
      return lines.slice(i + 1).join('\n')
    }
    return cleaned
  }
  return ''
}
