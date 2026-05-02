import { app, shell, BrowserWindow, session, screen } from 'electron'
import { execSync } from 'child_process'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerFilesystemIpc, onVaultReady } from './ipc/filesystem'
import { registerWatcherIpc, getVaultWatcher } from './ipc/watcher'
import { registerShellIpc, getShellService } from './ipc/shell'
import { registerConfigIpc, readAppConfigValue, writeAppConfigValue } from './ipc/config'

import { registerProjectIpc, getProjectWatcher, getSessionTailer } from './ipc/workbench'
import { registerDocumentIpc, getDocumentManager } from './ipc/documents'
import { registerMcpIpc } from './ipc/mcp'
import { registerAgentIpc, setAgentServices, stopAgentServices } from './ipc/agents'
import { registerActionsIpc, setActionsVaultRoot } from './ipc/actions'
import { registerCanvasIpc } from './ipc/canvas'
import { registerArtifactIpc } from './ipc/artifact'
import { registerGhostEmergeIpc } from './ipc/ghost-emerge'
import { registerHealthIpc, setHealthMonitor, emitHealthReport } from './ipc/health'
import { registerClaudeStatusIpc } from './ipc/claude-status'
import { registerThreadIpc } from './ipc/thread-ipc'
import { registerAgentNativeIpc } from './ipc/agent-native-ipc'
import { registerCliThreadIpc } from './ipc/cli-thread'
import { McpLifecycle } from './services/mcp-lifecycle'
import { PtyMonitor } from './services/pty-monitor'
import { AgentSpawner } from './services/agent-spawner'
import { initVaultIndex } from './services/vault-indexing'
import { VaultHealthMonitor } from './services/vault-health-monitor'
import { FsErrorLog } from './services/fs-error-log'
import { ClaudeStatusService } from './services/claude-status-service'
import { typedHandle } from './typed-ipc'
import { getMainWindow, setMainWindow } from './window-registry'
import { QuitCoordinator } from './services/quit-coordinator'
import { installMainLogger } from './services/main-logger'
import { attachExternalNavigationGuards } from './services/external-navigation'
import {
  DEFAULT_MAIN_WINDOW_STATE,
  captureWindowState,
  resolveInitialWindowState,
  type WindowState
} from './services/window-state'

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:"
].join('; ')

const APP_ID = 'com.caseytalbot.machina'
const WINDOW_STATE_KEY = 'window.bounds'
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 300

installMainLogger()

function normalizeProcessError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function shouldIgnoreProcessError(error: Error): boolean {
  return error.message === 'write EPIPE'
}

function reportProcessError(
  kind: 'uncaughtException' | 'unhandledRejection',
  error: unknown
): void {
  const normalized = normalizeProcessError(error)
  if (kind === 'uncaughtException' && shouldIgnoreProcessError(normalized)) {
    return
  }

  console.error(`[main:${kind}]`, normalized)
}

process.on('uncaughtException', (err) => {
  reportProcessError('uncaughtException', err)
})

process.on('unhandledRejection', (reason) => {
  reportProcessError('unhandledRejection', reason)
})

// Resolve the user's full shell PATH for packaged builds.
// Finder launches inherit launchd's minimal PATH, which excludes Homebrew,
// nvm, pyenv, and other tools installed in the user's shell profile.
if (app.isPackaged) {
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const fullPath = execSync(`${shell} -l -c 'printf "%s" "$PATH"'`, {
      encoding: 'utf-8',
      timeout: 5000
    })
    if (fullPath) process.env.PATH = fullPath
  } catch (err) {
    console.error('PATH resolution failed, using inherited PATH:', err)
  }
}

// Ensure LANG is set for proper UTF-8 handling in child processes
if (!process.env.LANG) {
  process.env.LANG = 'en_US.UTF-8'
}

const mcpLifecycle = new McpLifecycle()
const quitCoordinator = new QuitCoordinator()
const claudeStatus = new ClaudeStatusService()
let healthMonitor: VaultHealthMonitor | null = null

function createWindow(): BrowserWindow {
  const savedWindowState = readAppConfigValue<WindowState>(WINDOW_STATE_KEY)
  const initialWindowState = resolveInitialWindowState(
    savedWindowState,
    screen.getAllDisplays(),
    DEFAULT_MAIN_WINDOW_STATE
  )

  const window = new BrowserWindow({
    width: initialWindowState.width,
    height: initialWindowState.height,
    minWidth: 1200,
    minHeight: 700,
    ...(typeof initialWindowState.x === 'number' ? { x: initialWindowState.x } : {}),
    ...(typeof initialWindowState.y === 'number' ? { y: initialWindowState.y } : {}),
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#111113',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegrationInWorker: true,
      webviewTag: true
    }
  })

  setMainWindow(window)

  let persistBoundsTimeout: ReturnType<typeof setTimeout> | null = null

  const persistWindowState = (): void => {
    if (window.isDestroyed()) return
    writeAppConfigValue(WINDOW_STATE_KEY, captureWindowState(window))
  }

  const schedulePersistWindowState = (): void => {
    if (persistBoundsTimeout) {
      clearTimeout(persistBoundsTimeout)
    }

    persistBoundsTimeout = setTimeout(() => {
      persistBoundsTimeout = null
      if (window.isDestroyed() || window.isMinimized()) return
      persistWindowState()
    }, WINDOW_STATE_SAVE_DEBOUNCE_MS)
  }

  window.on('ready-to-show', () => {
    window.show()
  })

  window.on('move', schedulePersistWindowState)
  window.on('resize', schedulePersistWindowState)
  window.on('close', () => {
    if (persistBoundsTimeout) {
      clearTimeout(persistBoundsTimeout)
      persistBoundsTimeout = null
    }
    persistWindowState()
  })

  window.on('closed', () => {
    if (getMainWindow() === window) {
      setMainWindow(null)
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (initialWindowState.isMaximized) {
    window.maximize()
  }

  return window
}

function registerWindowIpc(): void {
  typedHandle('window:minimize', () => {
    getMainWindow()?.minimize()
  })
  typedHandle('window:maximize', () => {
    const window = getMainWindow()
    if (window?.isMaximized()) window.unmaximize()
    else window?.maximize()
  })
  typedHandle('window:close', () => {
    getMainWindow()?.close()
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId(APP_ID)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  app.on('web-contents-created', (_event, contents) => {
    attachExternalNavigationGuards(contents, {
      rendererUrl: process.env['ELECTRON_RENDERER_URL'],
      openExternal: (url) => shell.openExternal(url)
    })
  })

  if (!is.dev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [PROD_CSP]
        }
      })
    })
  }

  registerConfigIpc()
  registerWindowIpc()
  registerFilesystemIpc()
  registerClaudeStatusIpc(claudeStatus)
  claudeStatus.start()
  quitCoordinator.registerIpc()

  // Wire MCP server creation and agent monitoring to vault initialization.
  // Reads all .md files, builds VaultIndex + SearchEngine, then creates MCP
  // server with populated deps so search and graph queries return real data.
  // Wire MCP + agent services to vault initialization.
  // Services update on vault switch without re-registering IPC handlers.
  onVaultReady(async (vaultPath) => {
    // Drop any pending-write suppression flags inherited from the previous
    // vault. Otherwise an inflight write against the old vault can leak
    // suppression into the new one and swallow legitimate external-change
    // notifications for same-pathed files.
    getDocumentManager().clearPendingWrites()

    const deps = await initVaultIndex(vaultPath)
    mcpLifecycle.createForVault(vaultPath, {
      ...deps,
      documentManager: getDocumentManager()
    })

    const monitor = new PtyMonitor(vaultPath, getShellService().getPtyService())
    const spawner = new AgentSpawner(getShellService(), vaultPath)
    setAgentServices(monitor, spawner)
    setActionsVaultRoot(vaultPath)

    if (!healthMonitor) {
      const errorLog = new FsErrorLog(32, (path) => getDocumentManager().hasPendingWrite(path))
      healthMonitor = new VaultHealthMonitor(getVaultWatcher(), errorLog, (report) =>
        emitHealthReport(report)
      )
    } else {
      healthMonitor.stop()
    }
    setHealthMonitor(healthMonitor)
    healthMonitor.switchVault(vaultPath)
    healthMonitor.start(vaultPath)
  })

  createWindow()
  registerWatcherIpc()
  registerShellIpc()

  registerDocumentIpc()
  registerProjectIpc()
  registerMcpIpc(mcpLifecycle)
  registerAgentIpc() // Register once at startup, services update via setAgentServices
  registerActionsIpc()
  registerCanvasIpc()
  registerArtifactIpc()
  registerGhostEmergeIpc()
  registerHealthIpc()
  registerThreadIpc()
  registerAgentNativeIpc()
  registerCliThreadIpc()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Coordinated quit: block quit → signal renderer to flush vault state → flush documents → quit
let quitCleanupDone = false
let quitCleanupPromise: Promise<void> | null = null

function logCleanupResult(step: string, result: PromiseSettledResult<void>): void {
  if (result.status === 'rejected') {
    console.error(`[quit] ${step} failed`, result.reason)
  }
}

app.on('before-quit', (event) => {
  if (quitCleanupDone) return // Cleanup already done, let quit proceed

  event.preventDefault() // Block quit until async cleanup completes
  if (quitCleanupPromise) return

  quitCleanupPromise = (async (): Promise<void> => {
    // Step 1: Signal renderer to flush vault state, wait up to 500ms
    await quitCoordinator.requestRendererFlush(() => getMainWindow(), 500)

    // Step 2: Flush all dirty documents
    try {
      await getDocumentManager().flushAll()
    } catch (err) {
      console.error('[quit] document flush failed', err)
    }

    // Step 3: Clean up services
    try {
      claudeStatus.stop()
    } catch (err) {
      console.error('[quit] claude status stop failed', err)
    }

    try {
      stopAgentServices()
    } catch (err) {
      console.error('[quit] agent service stop failed', err)
    }

    const cleanupResults = await Promise.allSettled([
      mcpLifecycle.stop(),
      getShellService().shutdown(),
      getVaultWatcher().stop(),
      getProjectWatcher().stop(),
      getSessionTailer()?.stop() ?? Promise.resolve()
    ])

    logCleanupResult('mcp stop', cleanupResults[0])
    logCleanupResult('shell shutdown', cleanupResults[1])
    logCleanupResult('vault watcher stop', cleanupResults[2])
    logCleanupResult('project watcher stop', cleanupResults[3])
    logCleanupResult('session tailer stop', cleanupResults[4])
  })()
    .catch((err) => {
      console.error('[quit] cleanup failed', err)
    })
    .finally(() => {
      quitCleanupDone = true
      quitCleanupPromise = null
      app.quit()
    })
})

// macOS keeps apps alive when all windows are closed (reactivated via dock icon)
app.on('window-all-closed', () => {
  // no-op: activate handler in whenReady re-creates the window
})
