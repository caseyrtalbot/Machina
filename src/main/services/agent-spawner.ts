import { randomUUID } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { ShellService } from './shell-service'
import type { AgentSpawnRequest } from '@shared/agent-types'
import type { SessionId } from '@shared/types'
import { TE_DIR } from '@shared/constants'

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

export class AgentSpawner {
  constructor(
    private readonly shellService: ShellService,
    private readonly vaultRoot: string
  ) {}

  spawn(request: AgentSpawnRequest): SessionId {
    const sessionId = randomUUID()
    const wrapperPath = __dirname.includes('.asar')
      ? join(process.resourcesPath, 'scripts', 'agent-wrapper.sh')
      : join(__dirname, '../../scripts/agent-wrapper.sh')

    const basePrompt = readAgentPrompt(this.vaultRoot)
    const userPrompt = request.prompt

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
