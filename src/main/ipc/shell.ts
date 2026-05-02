import { ShellService } from '../services/shell-service'
import { typedHandle, typedHandleWithEvent } from '../typed-ipc'
import { register, unregister, getWebContents } from '../services/session-router'
import { BlockWatcher } from '../services/block-watcher'
import { CLIAgentSessionListener } from '../services/cli-agent-session-listener'
import { CliAgentThreadBridge } from '../services/cli-agent-thread-bridge'
import { getMainWindow } from '../window-registry'
import type { SessionId } from '@shared/types'

const shellService = new ShellService()

function sendToMainWindow<T>(channel: string, payload: T): void {
  const win = getMainWindow()
  const wc = win?.webContents
  if (wc && !wc.isDestroyed()) {
    wc.send(channel, payload)
  }
}

const cliAgentListener = new CLIAgentSessionListener({
  onStatus: (status) => sendToMainWindow('cli-agent:session-status-changed', status),
  onContext: (status) => sendToMainWindow('cli-agent:context-updated', status)
})

const cliAgentThreadBridge = new CliAgentThreadBridge({
  onMessage: (event) => sendToMainWindow('thread:cli-message', event)
})

const blockWatcher = new BlockWatcher({
  onUpdate: ({ sessionId, block }) => {
    // block:update is consumed by the renderer's block-store + BlockCard,
    // not by the terminal webview. Route to the main BrowserWindow.
    sendToMainWindow('block:update', { sessionId: sessionId as SessionId, block })
    // Same snapshot feeds the CLI agent session listener so tool-call /
    // status changes emit on cli-agent:* channels.
    cliAgentListener.observe(sessionId, block)
    // And the thread bridge, which emits one ThreadMessage per completed
    // block on sessions that have been bound to a thread (Task 8.2).
    cliAgentThreadBridge.observe(sessionId, block)
  }
})

export function getCliAgentThreadBridge(): CliAgentThreadBridge {
  return cliAgentThreadBridge
}

const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/

function assertValidSessionId(id: string): void {
  if (!SESSION_ID_PATTERN.test(id)) {
    throw new Error(`Invalid sessionId format: ${id.slice(0, 20)}`)
  }
}

export function registerShellIpc(): void {
  shellService.setCallbacks(
    (sessionId, data) => {
      // Run block detection alongside the renderer-bound stream. The detector
      // is non-destructive: xterm.js silently absorbs unrecognized OSC 1337
      // sequences, so the same data can flow to both consumers.
      blockWatcher.observe(sessionId, data)
      const wc = getWebContents(sessionId)
      if (wc) wc.send('terminal:data', { sessionId, data })
    },
    (sessionId, code) => {
      blockWatcher.closeSession(sessionId)
      cliAgentListener.closeSession(sessionId)
      cliAgentThreadBridge.closeSession(sessionId)
      const wc = getWebContents(sessionId)
      if (wc) wc.send('terminal:exit', { sessionId, code })
      unregister(sessionId)
    }
  )

  typedHandleWithEvent('terminal:create', (args, event) => {
    const result = shellService.create(
      args.cwd,
      args.cols,
      args.rows,
      args.shell,
      args.label,
      args.vaultPath
    )
    register(result, event.sender.id)
    return result
  })

  typedHandle('terminal:write', async (args) => {
    assertValidSessionId(args.sessionId)
    shellService.write(args.sessionId, args.data)
  })

  typedHandle('terminal:send-raw-keys', async (args) => {
    assertValidSessionId(args.sessionId)
    shellService.sendRawKeys(args.sessionId, args.data)
  })

  typedHandle('terminal:resize', async (args) => {
    assertValidSessionId(args.sessionId)
    shellService.resize(args.sessionId, args.cols, args.rows)
  })

  typedHandle('terminal:kill', async (args) => {
    assertValidSessionId(args.sessionId)
    shellService.kill(args.sessionId)
  })

  typedHandle('terminal:process-name', async (args) => {
    assertValidSessionId(args.sessionId)
    return shellService.getProcessName(args.sessionId)
  })

  typedHandleWithEvent('terminal:reconnect', (args, event) => {
    assertValidSessionId(args.sessionId)
    const result = shellService.reconnect(args.sessionId, args.cols, args.rows)
    if (result) {
      register(args.sessionId, event.sender.id)
    }
    return result
  })
}

export function getShellService(): ShellService {
  return shellService
}
