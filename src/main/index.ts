import { app, shell, BrowserWindow, session, screen, crashReporter, dialog } from 'electron'
import { execSync } from 'child_process'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerFilesystemIpc } from './ipc/filesystem'
import { registerWorkspaceIpc } from './ipc/workspace'
import { getWorkspaceService } from './services/workspace-service'
import { registerWatcherIpc, getVaultWatcher, setVaultBatchListener } from './ipc/watcher'
import { registerShellIpc, getShellService } from './ipc/shell'
import { registerConfigIpc, readAppConfigValue, writeAppConfigValue } from './ipc/config'

import { registerDocumentIpc, getDocumentManager } from './ipc/documents'
import { registerAgentIpc, setAgentServices, stopAgentServices } from './ipc/agents'
import { registerCanvasIpc } from './ipc/canvas'
import { registerGhostEmergeIpc } from './ipc/ghost-emerge'
import { registerHealthIpc, setHealthMonitor, emitHealthReport } from './ipc/health'
import { registerClaudeStatusIpc } from './ipc/claude-status'
import { registerThreadIpc } from './ipc/thread-ipc'
import { registerAgentNativeIpc } from './ipc/agent-native-ipc'
import { registerCliThreadIpc } from './ipc/cli-thread'
import { registerPdfIndexIpc, setPdfIndexSearchEngine } from './ipc/pdf-index'
import {
  initApprovalsForRoot,
  markApprovalsWatcherDown,
  registerGitIpc,
  stopApprovals
} from './ipc/git'
import { registerHarnessIpc } from './ipc/harness'
import { registerEmbeddingsIpc, setEmbedderService } from './ipc/embeddings'
import { EmbedderService } from './services/embedder-service'
import { TE_DIR } from '../shared/constants'
import { McpLifecycle } from './services/mcp-lifecycle'
import { initAutoUpdates } from './services/auto-update'
import { PtyMonitor } from './services/pty-monitor'
import { initVaultIndex, createLiveIndexUpdater } from './services/vault-indexing'
import { VaultHealthMonitor } from './services/vault-health-monitor'
import { FsErrorLog } from './services/fs-error-log'
import { ClaudeStatusService } from './services/claude-status-service'
import { getMainWindow, setMainWindow } from './window-registry'
import { QuitCoordinator } from './services/quit-coordinator'
import {
  installMainLogger,
  logRendererConsole,
  resolveMainLogFilePath
} from './services/main-logger'
import { typedHandle } from './typed-ipc'
import { attachExternalNavigationGuards } from './services/external-navigation'
import {
  DEFAULT_MAIN_WINDOW_STATE,
  captureWindowState,
  resolveInitialWindowState,
  type WindowState
} from './services/window-state'

// No 'unsafe-eval': the only dep that needed it (Pixi's new Function uniform
// codegen) is isolated via the 'pixi.js/unsafe-eval' shim imported by
// graph-renderer.ts. js-yaml's and pdfjs's eval paths are feature-detected or
// dead (gray-matter runs with JS types disabled).
// Fonts: defaults are bundled woff2 (renderer assets/fonts), so style-src and
// font-src stay local-only. User-chosen Google Fonts load via fetch() +
// FontFace (design/google-fonts.ts), confined to connect-src.
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com"
].join('; ')

const APP_ID = 'com.machina.app'
const WINDOW_STATE_KEY = 'window.bounds'
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 300

installMainLogger()

// Local minidumps only — no remote telemetry (local-first product). Must be
// called before app 'ready'.
crashReporter.start({ uploadToServer: false })

function normalizeProcessError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function shouldIgnoreProcessError(error: Error): boolean {
  return error.message === 'write EPIPE'
}

// One dialog per process lifetime: a crash loop must not stack modals.
let crashDialogShown = false

function offerRelaunchAfterCrash(error: Error): void {
  if (crashDialogShown || !app.isReady()) return
  crashDialogShown = true
  void dialog
    .showMessageBox({
      type: 'error',
      title: 'Machina',
      message: 'Machina hit an unexpected error.',
      detail: error.stack ?? error.message,
      buttons: ['Relaunch', 'Continue'],
      defaultId: 0,
      cancelId: 1
    })
    .then(({ response }) => {
      if (response === 0) {
        app.relaunch()
        app.exit(0)
      }
    })
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

  if (kind === 'uncaughtException') {
    offerRelaunchAfterCrash(normalized)
  }
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

const RENDERER_CRASH_WINDOW_MS = 60_000
let rendererCrashTimes: readonly number[] = []

const mcpLifecycle = new McpLifecycle()
const quitCoordinator = new QuitCoordinator()
const claudeStatus = new ClaudeStatusService()
let healthMonitor: VaultHealthMonitor | null = null

function ensureHealthMonitor(): VaultHealthMonitor {
  if (healthMonitor) {
    healthMonitor.stop()
    return healthMonitor
  }
  const errorLog = new FsErrorLog(32, (path) => getDocumentManager().hasPendingWrite(path))
  healthMonitor = new VaultHealthMonitor(getVaultWatcher(), errorLog, (report) =>
    emitHealthReport(report)
  )
  return healthMonitor
}

// Awaited from vault:init so failures surface to the caller instead of
// becoming unhandled rejections.
async function reconfigureForVault(vaultPath: string): Promise<void> {
  // Disarm the old workspace's agent write watcher BEFORE anything else:
  // the active workspace has already flipped, and a stale watcher batch
  // routing against the new root is destructive (autoReject discards).
  await stopApprovals()

  // Drop any pending-write suppression flags inherited from the previous
  // vault. Otherwise an inflight write against the old vault can leak
  // suppression into the new one and swallow legitimate external-change
  // notifications for same-pathed files.
  getDocumentManager().clearPendingWrites()

  const deps = await initVaultIndex(vaultPath)

  // Keep the index live: watcher batches re-parse changed .md files into the
  // same VaultIndex/SearchEngine the MCP facade queries (frozen-at-open bug).
  setVaultBatchListener(createLiveIndexUpdater(deps))

  // PDF text indexed by the renderer (3.10a) lands in the same SearchEngine.
  setPdfIndexSearchEngine(deps.searchEngine)

  // Opt-in local embeddings (3.11): the service follows the SearchEngine
  // corpus (notes + PDF pages) but stays fully inert — no model download,
  // no disk writes — until the renderer's Settings toggle enables it.
  const embedder = new EmbedderService({
    storageDir: join(vaultPath, TE_DIR, 'embeddings'),
    modelCacheDir: join(app.getPath('userData'), 'transformers-cache')
  })
  embedder.attach(deps.searchEngine)
  setEmbedderService(embedder)

  mcpLifecycle.createForVault(vaultPath, {
    ...deps,
    documentManager: getDocumentManager()
  })

  // Serve the gated tools to external MCP clients on localhost. A listen
  // failure must not fail vault init — status just reports not-running.
  void mcpLifecycle.startTransport().catch((err) => {
    console.error('[mcp] failed to start HTTP transport', err)
  })

  const monitor = new PtyMonitor(vaultPath, getShellService().getPtyService())
  setAgentServices(monitor)

  const health = ensureHealthMonitor()
  setHealthMonitor(health)
  health.switchVault(vaultPath)
  health.start(vaultPath)

  // Gate parity (step 3): re-bind the agent write watcher + approval queue
  // to the new root. A watcher failure must not fail vault init — the gate
  // goes visibly DOWN (health broadcast + backoff restart, step 2 contracts
  // §4 v1.2.1), never a blocked workspace.
  try {
    await initApprovalsForRoot(vaultPath)
  } catch (err) {
    console.error('[approvals] failed to start agent write watcher', err)
    markApprovalsWatcherDown(err instanceof Error ? err.message : String(err))
  }
}

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
    trafficLightPosition: { x: 12, y: 14 },
    backgroundColor: '#111113',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegrationInWorker: true,
      webviewTag: true
    }
  })

  setMainWindow(window)

  // Crash recovery: reload restores the renderer (PTYs reconnect, state.json
  // restores). Two crashes inside a minute means a crash loop — ask instead
  // of spinning.
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    console.error(`[main] renderer process gone: ${details.reason} (exit code ${details.exitCode})`)

    const now = Date.now()
    rendererCrashTimes = [
      ...rendererCrashTimes.filter((t) => now - t < RENDERER_CRASH_WINDOW_MS),
      now
    ]

    if (rendererCrashTimes.length >= 2) {
      void dialog
        .showMessageBox(window, {
          type: 'error',
          title: 'Machina',
          message: 'The window crashed twice in the last minute.',
          detail: `Reason: ${details.reason}`,
          buttons: ['Reload', 'Quit'],
          defaultId: 0,
          cancelId: 1
        })
        .then(({ response }) => {
          if (window.isDestroyed()) return
          if (response === 0) {
            window.webContents.reload()
          } else {
            app.quit()
          }
        })
      return
    }

    if (!window.isDestroyed()) {
      window.webContents.reload()
    }
  })

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

app.whenReady().then(() => {
  electronApp.setAppUserModelId(APP_ID)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const terminalWebviewPreload = resolve(join(__dirname, '../preload/terminal-webview.js'))

  const normalizePreloadPath = (preload: string): string => {
    try {
      return resolve(preload.startsWith('file:') ? fileURLToPath(preload) : preload)
    } catch {
      return preload
    }
  }

  app.on('web-contents-created', (_event, contents) => {
    attachExternalNavigationGuards(contents, {
      rendererUrl: process.env['ELECTRON_RENDERER_URL'],
      openExternal: (url) => shell.openExternal(url)
    })

    // Only the terminal webview, with its dedicated preload, may attach.
    // Anything else (injected <webview>, tampered preload) is blocked.
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      const requested = webPreferences.preload ?? params.preload ?? ''
      if (normalizePreloadPath(requested) !== terminalWebviewPreload) {
        console.error('[main] blocked webview attach with unexpected preload:', requested)
        event.preventDefault()
        return
      }
      webPreferences.preload = terminalWebviewPreload
      webPreferences.contextIsolation = true
      webPreferences.nodeIntegration = false
      webPreferences.nodeIntegrationInSubFrames = false
    })

    // Forward renderer warnings/errors into main.log so production bug
    // reports carry renderer context.
    contents.on('console-message', (details) => {
      if (details.level !== 'warning' && details.level !== 'error') return
      logRendererConsole(details.level, details.message, details.sourceId, details.lineNumber)
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

  // "Reveal logs" affordance (Settings): open main.log in Finder.
  typedHandle('app:reveal-logs', () => {
    shell.showItemInFolder(resolveMainLogFilePath())
  })

  // MCP endpoint status for the Settings surface (running, URL, tool count).
  typedHandle('mcp:status', () => mcpLifecycle.status())

  registerConfigIpc()
  registerFilesystemIpc()
  registerWorkspaceIpc()
  registerClaudeStatusIpc(claudeStatus)
  claudeStatus.start()
  quitCoordinator.registerIpc()

  // Wire MCP + agent + health services to workspace initialization. The
  // controller rebuilds the index + MCP server and re-points services on each
  // workspace switch without re-registering IPC handlers.
  getWorkspaceService().onReady((ws) => reconfigureForVault(ws.root))

  createWindow()
  registerWatcherIpc()
  registerShellIpc()

  registerDocumentIpc()
  registerAgentIpc() // Register once at startup, services update via setAgentServices
  registerCanvasIpc()
  registerGhostEmergeIpc()
  registerHealthIpc()
  registerThreadIpc()
  registerAgentNativeIpc()
  registerCliThreadIpc()
  registerPdfIndexIpc()
  registerEmbeddingsIpc()
  registerGitIpc()
  registerHarnessIpc()

  // No-ops unless a publish feed is configured (see auto-update.ts).
  void initAutoUpdates({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    feedUrl: process.env.MACHINA_UPDATE_FEED_URL
  }).catch((err) => {
    console.error('[auto-update] init failed', err)
  })

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
    // Step 1: Signal renderer to flush vault state, canvas, dirty docs, and
    // the active thread's dock tabs. 2.5s budget — 500ms raced real multi-file
    // flushes and silently dropped whatever hadn't landed.
    await quitCoordinator.requestRendererFlush(() => getMainWindow(), 2500)

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
      getVaultWatcher().stop()
    ])

    logCleanupResult('mcp stop', cleanupResults[0])
    logCleanupResult('shell shutdown', cleanupResults[1])
    logCleanupResult('vault watcher stop', cleanupResults[2])
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
