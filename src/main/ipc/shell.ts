import { app } from 'electron'
import { readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { ShellService } from '../services/shell-service'
import {
  detectShell,
  getShellHookStatus,
  hookTarget,
  installShellHooks
} from '../services/shell-hook-installer'
import { typedHandle, typedHandleWithEvent } from '../typed-ipc'
import { register, unregister, getWebContents } from '../services/session-router'
import { BlockWatcher } from '../services/block-watcher'
import { CLIAgentSessionListener } from '../services/cli-agent-session-listener'
import { CliAgentThreadBridge } from '../services/cli-agent-thread-bridge'
import { getCliTurnRegistry } from '../services/cli-turn-registry'
import { getAgentCircuitBreaker } from '../services/agent-circuit-breaker'
import { getAgentCostLedger } from '../services/agent-cost-ledger'
import { getHarnessRunRegistry } from '../services/harness-run-registry'
import { markBlockSeen, clearSession } from '../services/shell-readiness'
import { ThreadStorage } from '../services/thread-storage'
import { AuditLogger } from '../services/audit-logger'
import { checkHeadMovedAtTurnEnd } from './git'
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

/**
 * Lazy audit singleton for failed transcript appends (P3 step 4 review
 * hardening): main is the SOLE message writer, so a dropped assistant final
 * is a lost transcript line — console output alone is not a durable surface.
 * Same userData/audit location as the cli-thread logger (AuditLogger appends,
 * so parallel instances on one dir are safe); defined here because importing
 * ipc/cli-thread's logger would create a module cycle.
 */
let appendAudit: AuditLogger | null = null

function getAppendAudit(): AuditLogger {
  if (appendAudit === null) {
    appendAudit = new AuditLogger(join(app.getPath('userData'), 'audit'))
  }
  return appendAudit
}

function auditAppendFailure(threadId: string, root: string, error: string): void {
  getAppendAudit().log({
    ts: new Date().toISOString(),
    tool: 'thread:append-failed',
    args: { threadId, root },
    affectedPaths: [],
    decision: 'error',
    error
  })
}

const cliAgentListener = new CLIAgentSessionListener({
  onStatus: (status) => sendToMainWindow('cli-agent:session-status-changed', status),
  onContext: (status) => sendToMainWindow('cli-agent:context-updated', status)
})

const cliAgentThreadBridge = new CliAgentThreadBridge({
  onMessage: (event) => sendToMainWindow('thread:cli-message', event),
  // Turn-window close for the gate-parity attribution registry (step 3):
  // once per completed block, which is once per CLI turn. When a turn
  // actually closes, run the end-of-turn headMoved check — a final
  // self-commit produces no watched fs event, so this is its only tripwire.
  // P3 step 4 (contracts §4 v1.3.3): main is the persistence authority for
  // the final assistant message — append it here, then push thread:changed.
  onTurnComplete: (threadId, message, bindCwd, costUsd) => {
    const closed = getCliTurnRegistry().turnEnded(threadId)
    if (closed !== undefined) checkHeadMovedAtTurnEnd(closed)
    // Root: the turn window's cwd when one closed; otherwise the bridge's
    // bind-time cwd — still alive on the mid-turn-kill path where close()
    // already wiped the spawner maps and the turn window.
    const root = closed?.cwd ?? bindCwd
    void (async () => {
      try {
        const appended = await new ThreadStorage(root).appendMessage(threadId, message)
        if (appended) sendToMainWindow('thread:changed', { root, threadId })
        else console.error(`thread append skipped (file missing): ${threadId} in ${root}`)
      } catch (err) {
        // Main is the sole message writer now: a failed append is a lost
        // transcript line — say so loudly (console + durable audit entry),
        // never reject unhandled.
        console.error(`thread append failed: ${threadId} in ${root}`, err)
        auditAppendFailure(threadId, root, String(err))
      }
    })()
    // Cost vertical (P3 step 5, contracts v1.3.4): a null delta means "no
    // cost observation this turn" — nothing fires (never zeroed). Unbound
    // threads still get per-thread accumulation + noteCost (observability);
    // the durable ledger is slug-keyed, so no slug means no ledger entry.
    if (costUsd !== null) {
      const cumulative = getCliAgentThreadBridge().getThreadCostUsd(threadId) ?? costUsd
      getAgentCircuitBreaker().noteCost({
        threadId,
        agentId: closed?.agentId ?? threadId,
        turnCostUsd: costUsd,
        cumulativeUsd: cumulative
      })
      void (async () => {
        try {
          await getHarnessRunRegistry().ensureRootReady(root)
        } catch {
          return
        }
        const slug = getHarnessRunRegistry().get(root, threadId)?.slug
        if (slug === undefined) return
        try {
          await getAgentCostLedger().recordSpend(root, slug, costUsd)
        } catch (err) {
          // A failed persist loses at most this increment from the durable
          // floor — undercount direction, surfaced, never rethrown here.
          console.error(`cost ledger record failed: ${threadId} in ${root}`, err)
        }
      })()
    }
  }
})

const blockWatcher = new BlockWatcher({
  onUpdate: ({ sessionId, block }) => {
    // Feed the main-side readiness tracker (P3 step 4): the first block on a
    // fresh session is its shell prompt — the send-safe signal.
    markBlockSeen(sessionId)
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
      clearSession(sessionId)
      cliAgentListener.closeSession(sessionId)
      cliAgentThreadBridge.closeSession(sessionId)
      const wc = getWebContents(sessionId)
      if (wc) wc.send('terminal:exit', { sessionId, code })
      // Also notify the main renderer (like block:update) so terminal status
      // hooks (useTerminalStatus.markSettled) and block-store cleanup fire.
      sendToMainWindow('terminal:exit', { sessionId: sessionId as SessionId, code })
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

  // ── Block-protocol shell hooks ────────────────────────────────────────
  // resources/** ships inside the app bundle (asarUnpack), so the bundled
  // hook is readable at app.getAppPath()/resources in both dev and prod.

  typedHandle('shell:hooks-status', async () => {
    const target = hookTarget(detectShell(process.env.SHELL), homedir())
    return getShellHookStatus(target)
  })

  typedHandle('shell:install-hooks', async () => {
    const target = hookTarget(detectShell(process.env.SHELL), homedir())
    const sourcePath = join(app.getAppPath(), 'resources', 'shell-hooks', target.hookFileName)
    try {
      const content = await readFile(sourcePath, 'utf-8')
      return await installShellHooks(target, content)
    } catch (error) {
      return {
        ok: false,
        shell: target.shell,
        hookPath: target.hookPath,
        rcPath: target.rcPath,
        rcUpdated: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
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
