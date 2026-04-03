import { randomUUID } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { spawn as cpSpawn } from 'child_process'
import type { ShellService } from './shell-service'
import type { AgentSpawnRequest } from '@shared/agent-types'
import type { SessionId } from '@shared/types'
import type { LibrarianMonitor } from './librarian-monitor'
import type { ClaudeStatusService } from './claude-status-service'
import { TE_DIR } from '@shared/constants'
import bundledLibrarianPrompt from './default-librarian-prompt.md?raw'
import bundledCuratorPrompt from './default-curator-prompt.md?raw'

/** Shell-escape a string by wrapping in single quotes and escaping embedded quotes. */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

/** Read the librarian system prompt, preferring a user-customized file over the bundled default. */
function readLibrarianPrompt(vaultRoot: string): string {
  const userCustomized = join(vaultRoot, TE_DIR, 'librarian-prompt.md')
  if (existsSync(userCustomized)) {
    return readFileSync(userCustomized, 'utf-8')
  }
  return bundledLibrarianPrompt
}

/** Curator mode descriptions, keyed by mode ID. */
const CURATOR_MODES: Record<string, string> = {
  critique:
    'Critically examine proposals from the librarian report. For each finding, add a "## Critique" ' +
    'section to the relevant vault file examining assumptions, contradictions, and missing perspectives.',
  challenge:
    'Stress-test ideas from the librarian report. For each proposal, add a "## Challenge" ' +
    'section to the relevant vault file examining assumptions, contradictions, and missing perspectives.',
  emerge:
    'Surface hidden connections identified in the librarian report. Add "## Connections" ' +
    'sections with wikilinks and synthesis notes to relevant vault files.',
  research:
    'Address gaps and forward questions from the librarian report. Add "## Research" ' +
    'sections with findings, citations, and proposed directions.',
  learn:
    'Extract learning points from the librarian report. Add "## Key Learnings" ' +
    'sections summarizing insights and creating study-oriented content.'
}

/** Read the curator system prompt, preferring a user-customized file over the bundled default. */
function readCuratorPrompt(vaultRoot: string): string {
  const userCustomized = join(vaultRoot, TE_DIR, 'curator-prompt.md')
  if (existsSync(userCustomized)) {
    return readFileSync(userCustomized, 'utf-8')
  }
  return bundledCuratorPrompt
}

/** Read the agent system prompt, preferring a user-customized file over the bundled default. */
function readAgentPrompt(vaultRoot: string): string | null {
  const userCustomized = join(vaultRoot, TE_DIR, 'agent-prompt.md')
  if (existsSync(userCustomized)) {
    return readFileSync(userCustomized, 'utf-8')
  }

  const bundledDefault = __dirname.includes('.asar')
    ? join(process.resourcesPath, 'services', 'default-agent-prompt.md')
    : join(__dirname, 'default-agent-prompt.md')

  if (existsSync(bundledDefault)) {
    return readFileSync(bundledDefault, 'utf-8')
  }

  return null
}

export class AgentSpawner {
  private librarianMonitor: LibrarianMonitor | null = null

  constructor(
    private readonly shellService: ShellService,
    private readonly vaultRoot: string,
    private readonly claudeStatus?: ClaudeStatusService
  ) {}

  /** Check if Claude CLI is available and authenticated. Returns error string or null. */
  private checkClaudeAvailability(): string | null {
    if (!this.claudeStatus) return null
    const status = this.claudeStatus.getStatus()
    if (!status.installed) return 'Claude Code CLI is not installed'
    if (!status.authenticated) return 'Claude is not signed in. Run "claude auth login" first.'
    return null
  }

  setLibrarianMonitor(monitor: LibrarianMonitor): void {
    this.librarianMonitor = monitor
  }

  /** Spawn a librarian as a direct child process (no tmux, no wrapper script). */
  spawnLibrarian(
    vaultPath: string,
    selectedFiles?: readonly string[]
  ): { sessionId: string } | { error: string } {
    const claudeError = this.checkClaudeAvailability()
    if (claudeError) return { error: claudeError }

    const sessionId = randomUUID()
    const systemPrompt = readLibrarianPrompt(this.vaultRoot)

    const scopeNote =
      selectedFiles && selectedFiles.length > 0
        ? `Focus ONLY on these files:\n${selectedFiles.map((f) => `- ${f}`).join('\n')}`
        : 'Run the librarian workflow on this vault.'

    const args = [
      '-p',
      '--dangerously-skip-permissions',
      '--allowedTools',
      'Read,Write,Edit,Glob,Grep,Bash',
      '--model',
      'sonnet',
      scopeNote
    ]

    args.unshift('--system-prompt', systemPrompt)

    const child = cpSpawn('claude', args, {
      cwd: vaultPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      this.librarianMonitor?.setLastOutput(sessionId, chunk.toString())
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      this.librarianMonitor?.setLastOutput(sessionId, chunk.toString())
    })

    const killFn = () => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* already dead */
      }
    }

    this.librarianMonitor?.register(sessionId, child.pid ?? 0, vaultPath, killFn)

    child.on('exit', (code) => {
      this.librarianMonitor?.complete(sessionId, code ?? 0)
      // Auto-cleanup after a short delay so the UI can show the exited state
      setTimeout(() => {
        this.librarianMonitor?.cleanup(sessionId)
      }, 5000)
    })

    child.on('error', (err) => {
      console.error(`Librarian process error: ${err.message}`)
      this.librarianMonitor?.complete(sessionId, 1)
    })

    return { sessionId }
  }

  /** Spawn a curator as a direct child process. */
  spawnCurator(
    vaultPath: string,
    mode: string,
    selectedFiles?: readonly string[]
  ): { sessionId: string } | { error: string } {
    const claudeError = this.checkClaudeAvailability()
    if (claudeError) return { error: claudeError }

    const sessionId = randomUUID()
    let systemPrompt = readCuratorPrompt(this.vaultRoot)

    const modeDescription =
      CURATOR_MODES[mode] ??
      `Apply the "${mode}" workflow to the vault based on the librarian report.`

    if (systemPrompt) {
      systemPrompt = systemPrompt
        .replace('{{MODE}}', mode.charAt(0).toUpperCase() + mode.slice(1))
        .replace('{{MODE_DESCRIPTION}}', modeDescription)
    }

    const scopeNote =
      selectedFiles && selectedFiles.length > 0
        ? `Run the curator ${mode} workflow. Focus ONLY on these files:\n${selectedFiles.map((f) => `- ${f}`).join('\n')}\nUse the librarian reports in _librarian/ for context.`
        : `Run the curator ${mode} workflow on this vault using the librarian reports in _librarian/.`

    const args = [
      '-p',
      '--dangerously-skip-permissions',
      '--allowedTools',
      'Read,Write,Edit,Glob,Grep,Bash',
      '--model',
      'sonnet',
      scopeNote
    ]

    args.unshift('--system-prompt', systemPrompt)

    const child = cpSpawn('claude', args, {
      cwd: vaultPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      this.librarianMonitor?.setLastOutput(sessionId, chunk.toString())
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      this.librarianMonitor?.setLastOutput(sessionId, chunk.toString())
    })

    const killFn = () => {
      try {
        child.kill('SIGTERM')
      } catch {
        /* already dead */
      }
    }

    this.librarianMonitor?.register(sessionId, child.pid ?? 0, vaultPath, killFn, 'curator')

    child.on('exit', (code) => {
      this.librarianMonitor?.complete(sessionId, code ?? 0)
      setTimeout(() => {
        this.librarianMonitor?.cleanup(sessionId)
      }, 5000)
    })

    child.on('error', (err) => {
      console.error(`Curator process error: ${err.message}`)
      this.librarianMonitor?.complete(sessionId, 1)
    })

    return { sessionId }
  }

  spawn(request: AgentSpawnRequest): SessionId {
    const sessionId = randomUUID()
    const wrapperPath = __dirname.includes('.asar')
      ? join(process.resourcesPath, 'scripts', 'agent-wrapper.sh')
      : join(__dirname, '../../scripts/agent-wrapper.sh')

    // Choose prompt based on action type
    const isLibrarian = request.prompt?.includes('/librarian') ?? false
    const basePrompt = isLibrarian
      ? readLibrarianPrompt(this.vaultRoot)
      : readAgentPrompt(this.vaultRoot)
    const userPrompt = isLibrarian ? undefined : request.prompt

    const fullPrompt =
      basePrompt && userPrompt
        ? `${basePrompt}\n\n---\n\n# User Request\n\n${userPrompt}`
        : (basePrompt ?? userPrompt ?? undefined)

    const args = [
      'bash',
      shellEscape(wrapperPath),
      '--session-id',
      shellEscape(sessionId),
      '--vault-root',
      shellEscape(this.vaultRoot),
      '--cwd',
      shellEscape(request.cwd)
    ]

    if (fullPrompt) {
      args.push('--prompt', shellEscape(fullPrompt))
    }

    const label = `agent:${sessionId.slice(0, 8)}`

    return this.shellService.create(
      request.cwd,
      undefined,
      undefined,
      args.join(' '),
      label,
      this.vaultRoot
    )
  }
}
