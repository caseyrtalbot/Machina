/**
 * CLI agent installation/version detector.
 *
 * Pure logic + a thin shell-out, kept dependency-injectable so it stays
 * testable without mocking `child_process`. Drives the `agent:list-installed`
 * IPC channel and is delegated to by `claude-status-service` for Claude's
 * version probe.
 *
 * Concept-borrowed from Warp's `cli/agents/detect.rs`. Clean-room TypeScript.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { CLI_AGENTS, type CLIAgentInstallation, type CLIAgentSpec } from '../../shared/cli-agents'

export type { CLIAgentInstallation }

/** Subset of `promisify(execFile)` we depend on. */
export type ExecFn = (
  cmd: string,
  args: readonly string[],
  opts?: { timeout?: number }
) => Promise<{ stdout: string; stderr: string }>

const PROBE_TIMEOUT_MS = 5_000

const defaultExec: ExecFn = (() => {
  const wrapped = promisify(execFile)
  return async (cmd, args, opts) => {
    const { stdout, stderr } = await wrapped(cmd, [...args], { ...opts, encoding: 'utf8' })
    return { stdout, stderr }
  }
})()

/**
 * Pure: extract the version string from a CLI banner using `spec`'s regex.
 * Returns `null` when the banner is empty or fails to match.
 */
export function detectAgentVersion(spec: CLIAgentSpec, output: string): string | null {
  if (!output) return null
  const match = output.match(spec.detectVersionRegex)
  return match?.[1] ?? null
}

interface DetectOptions {
  readonly exec?: ExecFn
  readonly agents?: readonly CLIAgentSpec[]
}

/**
 * Probe each agent in parallel and return one row per spec describing whether
 * its CLI is installed and (if so) the parsed version.
 *
 * `exec` is injectable so tests can run without spawning real processes.
 */
export async function detectInstalledAgents(
  options: DetectOptions = {}
): Promise<readonly CLIAgentInstallation[]> {
  const exec = options.exec ?? defaultExec
  const agents = options.agents ?? CLI_AGENTS

  const probes = agents.map((spec) => probeOne(spec, exec))
  return Promise.all(probes)
}

async function probeOne(spec: CLIAgentSpec, exec: ExecFn): Promise<CLIAgentInstallation> {
  try {
    const { stdout } = await exec(spec.cliBinary, [spec.versionFlag], {
      timeout: PROBE_TIMEOUT_MS
    })
    return {
      id: spec.id,
      displayName: spec.displayName,
      brandColor: spec.brandColor,
      installed: true,
      version: detectAgentVersion(spec, stdout.trim()),
      error: null
    }
  } catch (err) {
    return {
      id: spec.id,
      displayName: spec.displayName,
      brandColor: spec.brandColor,
      installed: false,
      version: null,
      error: errorToMessage(err, spec)
    }
  }
}

function errorToMessage(err: unknown, spec: CLIAgentSpec): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT') return `${spec.cliBinary} not found in PATH`
  if (err instanceof Error) return err.message
  return 'unknown probe error'
}
