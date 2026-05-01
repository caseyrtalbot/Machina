/**
 * CLI agent registry.
 *
 * Single source of truth for the third-party AI coding CLIs the engine knows
 * about (Claude Code, Codex, Gemini). Pure data + a trivial lookup helper —
 * no I/O. Probing for installation/version lives in
 * `src/main/services/cli-agent-detector.ts` so this module stays importable
 * from the renderer.
 *
 * Concept-borrowed from Warp's `cli/agents/registry.rs`. Clean-room TypeScript.
 */

import {
  claudeToolCallParser,
  codexToolCallParser,
  geminiToolCallParser
} from './cli-agent-parsers'

export interface CLIAgentSpec {
  /** Stable identifier used on the wire and in IPC payloads. */
  readonly id: string
  /** Human-facing label shown in UI surfaces. */
  readonly displayName: string
  /** Brand colour used for chips and badges. Lower-case hex `#rrggbb`. */
  readonly brandColor: string
  /** Executable name to look up on `PATH`. */
  readonly cliBinary: string
  /** Argument that prints the version banner (e.g. `--version`). */
  readonly versionFlag: string
  /** Regex with one capture group that extracts the semver-ish version. */
  readonly detectVersionRegex: RegExp
  /**
   * Optional parser that classifies a chunk of CLI output as tool calls. Used
   * by Move 8's session listener; left unset until per-agent parsers ship.
   */
  readonly toolCallParser?: (chunk: string) => readonly ToolCall[]
  /**
   * Where the rich-input field anchors when this agent is the active one in a
   * canvas card. Reserved for Move 5's `BlockCard`.
   */
  readonly richInputAnchor?: 'top' | 'bottom'
}

/**
 * Minimal placeholder for tool-call records emitted by per-agent parsers.
 * The shape is intentionally narrow until Move 8 fleshes it out.
 */
export interface ToolCall {
  readonly name: string
  readonly inputPreview: string
}

export const CLI_AGENTS = [
  {
    id: 'claude',
    displayName: 'Claude Code',
    brandColor: '#cc785c',
    cliBinary: 'claude',
    versionFlag: '--version',
    detectVersionRegex: /(\d+\.\d+\.\d+)/,
    toolCallParser: claudeToolCallParser
  },
  {
    id: 'codex',
    displayName: 'Codex CLI',
    brandColor: '#8c8c8c',
    cliBinary: 'codex',
    versionFlag: '--version',
    detectVersionRegex: /codex(?:-cli)?\s+v?(\d+\.\d+\.\d+)/i,
    toolCallParser: codexToolCallParser
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    brandColor: '#4285f4',
    cliBinary: 'gemini',
    versionFlag: '--version',
    detectVersionRegex: /gemini(?:-cli)?\s+v?(\d+\.\d+\.\d+)/i,
    toolCallParser: geminiToolCallParser
  }
] as const satisfies readonly CLIAgentSpec[]

export type CLIAgentId = (typeof CLI_AGENTS)[number]['id']

/** Returns the spec for `id`, or `null` if no agent is registered under it. */
export function getAgentSpec(id: string): CLIAgentSpec | null {
  return CLI_AGENTS.find((a) => a.id === id) ?? null
}

/**
 * One row of probe output, as returned over the `agent:list-installed`
 * IPC channel. Lives in shared so the renderer can type the response.
 */
export interface CLIAgentInstallation {
  readonly id: string
  readonly displayName: string
  readonly brandColor: string
  readonly installed: boolean
  readonly version: string | null
  readonly error: string | null
}
