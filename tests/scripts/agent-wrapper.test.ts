import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const SCRIPT_PATH = join(__dirname, '..', '..', 'scripts', 'agent-wrapper.sh')

/** Run the wrapper script with given args and a fake PATH that excludes real claude. */
function runWrapper(
  args: string,
  options: {
    /** Extra env vars */
    env?: Record<string, string>
    /** If true, add a fake claude stub to PATH */
    fakeClaudePath?: string
  } = {}
): { stdout: string; stderr: string; exitCode: number } {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    // Strip real claude from PATH to prevent accidental spawning
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    ...options.env
  }

  if (options.fakeClaudePath) {
    env.PATH = `${options.fakeClaudePath}:${env.PATH}`
  }

  try {
    const stdout = execSync(`bash "${SCRIPT_PATH}" ${args}`, {
      env,
      timeout: 10000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    })
    return { stdout, stderr: '', exitCode: 0 }
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string; status?: number }
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.status ?? 1
    }
  }
}

describe('agent-wrapper.sh', () => {
  let tmpVault: string
  let fakeClaudeDir: string

  beforeEach(() => {
    tmpVault = mkdtempSync(join(tmpdir(), 'te-agent-test-'))
    // Create a fake claude stub that exits immediately
    fakeClaudeDir = mkdtempSync(join(tmpdir(), 'te-fake-claude-'))
    const fakeClaudePath = join(fakeClaudeDir, 'claude')
    writeFileSync(fakeClaudePath, '#!/bin/bash\nexit 0\n', { mode: 0o755 })
  })

  afterEach(() => {
    rmSync(tmpVault, { recursive: true, force: true })
    rmSync(fakeClaudeDir, { recursive: true, force: true })
  })

  describe('argument validation', () => {
    it('exits with error when --session-id is missing', () => {
      const result = runWrapper(`--vault-root "${tmpVault}" --cwd "${tmpVault}"`)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('--session-id')
    })

    it('exits with error when --vault-root is missing', () => {
      const result = runWrapper(`--session-id test-123 --cwd "${tmpVault}"`)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('--vault-root')
    })

    it('exits with error when --cwd is missing', () => {
      const result = runWrapper(`--session-id test-123 --vault-root "${tmpVault}"`)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('--cwd')
    })
  })

  describe('sidecar directory and file creation', () => {
    it('creates .te/agents/ directory in vault root', () => {
      runWrapper(`--session-id test-123 --vault-root "${tmpVault}" --cwd "${tmpVault}"`, {
        fakeClaudePath: fakeClaudeDir
      })

      expect(existsSync(join(tmpVault, '.te', 'agents'))).toBe(true)
    })

    it('creates sidecar JSON file named by session-id', () => {
      runWrapper(
        `--session-id my-session --vault-root "${tmpVault}" --cwd "${tmpVault}" --no-cleanup`,
        { fakeClaudePath: fakeClaudeDir }
      )

      const sidecarPath = join(tmpVault, '.te', 'agents', 'my-session.json')
      expect(existsSync(sidecarPath)).toBe(true)
    })
  })

  describe('sidecar JSON schema', () => {
    it('contains required fields with correct types', () => {
      runWrapper(
        `--session-id schema-test --vault-root "${tmpVault}" --cwd "${tmpVault}" --no-cleanup`,
        { fakeClaudePath: fakeClaudeDir }
      )

      const sidecarPath = join(tmpVault, '.te', 'agents', 'schema-test.json')
      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))

      expect(sidecar.agentType).toBe('claude-code')
      expect(sidecar.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(Array.isArray(sidecar.filesTouched)).toBe(true)
      expect(typeof sidecar.pid).toBe('number')
    })

    it('has status "completed" after clean claude exit', () => {
      runWrapper(
        `--session-id status-test --vault-root "${tmpVault}" --cwd "${tmpVault}" --no-cleanup`,
        { fakeClaudePath: fakeClaudeDir }
      )

      const sidecarPath = join(tmpVault, '.te', 'agents', 'status-test.json')
      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))

      expect(sidecar.status).toBe('completed')
    })

    it('includes exitCode after completion', () => {
      runWrapper(
        `--session-id exit-test --vault-root "${tmpVault}" --cwd "${tmpVault}" --no-cleanup`,
        { fakeClaudePath: fakeClaudeDir }
      )

      const sidecarPath = join(tmpVault, '.te', 'agents', 'exit-test.json')
      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))

      expect(sidecar.exitCode).toBe(0)
    })
  })

  describe('claude not installed', () => {
    it('writes error status to sidecar when claude is not found', () => {
      // Don't provide fakeClaudePath, so claude is not on PATH
      runWrapper(`--session-id no-claude --vault-root "${tmpVault}" --cwd "${tmpVault}"`)

      const sidecarPath = join(tmpVault, '.te', 'agents', 'no-claude.json')
      expect(existsSync(sidecarPath)).toBe(true)

      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
      expect(sidecar.status).toBe('error')
      expect(sidecar.error).toMatch(/claude.*not found/i)
    })

    it('exits cleanly (exit 0) when claude is not found', () => {
      const result = runWrapper(
        `--session-id no-claude-clean --vault-root "${tmpVault}" --cwd "${tmpVault}"`
      )

      // Script should exit 0 even if claude is not found (error written to sidecar)
      expect(result.exitCode).toBe(0)
    })
  })

  describe('sidecar cleanup on exit', () => {
    it('removes sidecar file after completion', () => {
      // Create a fake claude that exits with code 0
      runWrapper(`--session-id cleanup-test --vault-root "${tmpVault}" --cwd "${tmpVault}"`, {
        fakeClaudePath: fakeClaudeDir
      })

      const sidecarPath = join(tmpVault, '.te', 'agents', 'cleanup-test.json')
      // After normal exit the sidecar should be removed
      expect(existsSync(sidecarPath)).toBe(false)
    })
  })

  describe('non-zero claude exit', () => {
    it('captures non-zero exit code from claude', () => {
      // Create a claude stub that exits with code 1
      const failClaudeDir = mkdtempSync(join(tmpdir(), 'te-fail-claude-'))
      writeFileSync(join(failClaudeDir, 'claude'), '#!/bin/bash\nexit 42\n', { mode: 0o755 })

      // Use --no-cleanup to observe the sidecar before removal
      runWrapper(
        `--session-id fail-test --vault-root "${tmpVault}" --cwd "${tmpVault}" --no-cleanup`,
        { fakeClaudePath: failClaudeDir }
      )

      const sidecarPath = join(tmpVault, '.te', 'agents', 'fail-test.json')
      expect(existsSync(sidecarPath)).toBe(true)
      const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf-8'))
      expect(sidecar.status).toBe('completed')
      expect(sidecar.exitCode).toBe(42)

      rmSync(failClaudeDir, { recursive: true, force: true })
    })
  })

  describe('prompt passing', () => {
    it('passes prompt to claude as positional argument', () => {
      // Create a claude stub that echoes its args to a file
      const argsClaudeDir = mkdtempSync(join(tmpdir(), 'te-args-claude-'))
      const argsFile = join(tmpVault, 'claude-args.txt')
      writeFileSync(
        join(argsClaudeDir, 'claude'),
        `#!/bin/bash\necho "$@" > "${argsFile}"\nexit 0\n`,
        { mode: 0o755 }
      )

      runWrapper(
        `--session-id prompt-test --vault-root "${tmpVault}" --cwd "${tmpVault}" --prompt "Fix the parser"`,
        { fakeClaudePath: argsClaudeDir }
      )

      expect(existsSync(argsFile)).toBe(true)
      const args = readFileSync(argsFile, 'utf-8')
      expect(args).toContain('Fix the parser')
      // Prompt is positional, not passed via --prompt flag to claude CLI
      expect(args).not.toContain('--prompt')

      rmSync(argsClaudeDir, { recursive: true, force: true })
    })
  })
})
