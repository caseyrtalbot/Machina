import { randomUUID } from 'crypto'
import { join } from 'path'
import type { ShellService } from './shell-service'
import type { AgentSpawnRequest } from '@shared/agent-types'
import type { SessionId } from '@shared/types'

/** Shell-escape a string by wrapping in single quotes and escaping embedded quotes. */
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
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

    if (request.prompt) {
      args.push('--prompt', shellEscape(request.prompt))
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
