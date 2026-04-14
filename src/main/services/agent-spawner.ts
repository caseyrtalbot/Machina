import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { ShellService } from './shell-service'
import type { AgentSpawnRequest } from '@shared/agent-types'
import type { SessionId } from '@shared/types'
import { TE_DIR } from '@shared/constants'
import { commitPreAgentSnapshot } from './vault-git'

/** Shell-escape a string by wrapping in single quotes and escaping embedded quotes. */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
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

/**
 * Write the composed prompt to `<vaultRoot>/.te/agents/prompts/<sessionId>.txt`.
 * The wrapper reads this file and pipes it to claude, which sidesteps two
 * problems with inlining the prompt as a shell arg:
 * 1. MAX_ARG_STRLEN (~256KB macOS, 128KB Linux) can silently truncate exec args
 *    for bundled-prompt + user-prompt concatenations.
 * 2. The prompt is the highest-variability input; routing it through the
 *    filesystem removes it from the shell-escaping surface entirely.
 */
function writePromptFile(vaultRoot: string, sessionId: string, prompt: string): string {
  const promptsDir = join(vaultRoot, TE_DIR, 'agents', 'prompts')
  mkdirSync(promptsDir, { recursive: true })
  const promptPath = join(promptsDir, `${sessionId}.txt`)
  writeFileSync(promptPath, prompt, 'utf-8')
  return promptPath
}

export class AgentSpawner {
  constructor(
    private readonly shellService: ShellService,
    private readonly vaultRoot: string
  ) {}

  spawn(request: AgentSpawnRequest): SessionId {
    const sessionId = randomUUID()

    // Auto-commit pre-agent snapshot for rollback safety. No-op on non-git
    // vaults or when opted out. Never blocks the spawn on failure.
    const commit = commitPreAgentSnapshot(this.vaultRoot, sessionId)
    if (commit.reason === 'git-failed') {
      console.error(`[AgentSpawner] pre-agent snapshot failed: ${commit.error}`)
    }

    const wrapperPath = __dirname.includes('.asar')
      ? join(process.resourcesPath, 'scripts', 'agent-wrapper.sh')
      : join(__dirname, '../../scripts/agent-wrapper.sh')

    const basePrompt = readAgentPrompt(this.vaultRoot)
    const userPrompt = request.prompt

    const fullPrompt =
      basePrompt && userPrompt
        ? `${basePrompt}\n\n---\n\n# User Request\n\n${userPrompt}`
        : (basePrompt ?? userPrompt ?? null)

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
      const promptPath = writePromptFile(this.vaultRoot, sessionId, fullPrompt)
      args.push('--prompt-file', shellEscape(promptPath))
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
