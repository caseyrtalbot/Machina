import type { TmuxMonitor } from '../services/tmux-monitor'
import type { AgentSpawner } from '../services/agent-spawner'
import { LibrarianMonitor } from '../services/librarian-monitor'
import { typedHandle, typedSend } from '../typed-ipc'
import { getMainWindow } from '../window-registry'

let activeMonitor: TmuxMonitor | null = null
let activeSpawner: AgentSpawner | null = null
let librarianMonitor: LibrarianMonitor | null = null

export function registerAgentIpc(): void {
  typedHandle('agent:get-states', async () => {
    const tmuxStates = activeMonitor ? activeMonitor.getAgentStates() : []
    const librarianStates = librarianMonitor ? librarianMonitor.getStates() : []
    return [...tmuxStates, ...librarianStates]
  })

  typedHandle('agent:spawn', async (request) => {
    if (!activeSpawner) return { error: 'Agent spawner not available' }

    // Dispatch librarian spawns to the direct child_process path
    if (request.type === 'librarian') {
      return activeSpawner.spawnLibrarian(request.cwd)
    }

    // Dispatch curator spawns to the direct child_process path
    if (request.type === 'curator') {
      return activeSpawner.spawnCurator(request.cwd, request.curatorMode ?? 'emerge')
    }

    const sessionId = activeSpawner.spawn(request)
    return { sessionId }
  })
}

export function setAgentServices(monitor: TmuxMonitor | null, spawner: AgentSpawner | null): void {
  activeMonitor?.stop()

  activeMonitor = monitor
  activeSpawner = spawner

  // Create and wire the librarian monitor
  librarianMonitor = new LibrarianMonitor()
  spawner?.setLibrarianMonitor(librarianMonitor)

  // Push librarian state changes to the renderer
  librarianMonitor.setOnChange((librarianStates) => {
    const window = getMainWindow()
    if (window) {
      const tmuxStates = activeMonitor ? activeMonitor.getAgentStates() : []
      typedSend(window, 'agent:states-changed', {
        states: [...tmuxStates, ...librarianStates]
      })
    }
  })

  if (monitor) {
    monitor.start((tmuxStates) => {
      const window = getMainWindow()
      if (window) {
        const ls = librarianMonitor ? librarianMonitor.getStates() : []
        typedSend(window, 'agent:states-changed', {
          states: [...tmuxStates, ...ls]
        })
      }
    })
  }
}

export function stopAgentServices(): void {
  activeMonitor?.stop()
  activeMonitor = null
  activeSpawner = null
  librarianMonitor?.killAll()
  librarianMonitor = null
}
