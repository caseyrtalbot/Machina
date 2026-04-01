import { app, shell, BrowserWindow, session } from 'electron'
import { execSync } from 'child_process'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerFilesystemIpc, onVaultReady } from './ipc/filesystem'
import { registerWatcherIpc } from './ipc/watcher'
import { registerShellIpc, getShellService } from './ipc/shell'
import { registerConfigIpc } from './ipc/config'

import { registerProjectIpc, getProjectWatcher, getSessionTailer } from './ipc/workbench'
import { registerDocumentIpc, getDocumentManager } from './ipc/documents'
import { registerMcpIpc } from './ipc/mcp'
import { registerAgentIpc, setAgentServices, stopAgentServices } from './ipc/agents'
import { registerCanvasIpc } from './ipc/canvas'
import { McpLifecycle } from './services/mcp-lifecycle'
import { TmuxMonitor } from './services/tmux-monitor'
import { AgentSpawner } from './services/agent-spawner'
import { initVaultIndex } from './services/vault-indexing'
import { typedHandle } from './typed-ipc'
import { getMainWindow, setMainWindow } from './window-registry'
import { QuitCoordinator } from './services/quit-coordinator'

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:"
].join('; ')

// Prevent EPIPE from node-pty/shell service from crashing the app
process.on('uncaughtException', (err) => {
  if (err.message === 'write EPIPE') return
  console.error('Uncaught exception:', err)
})

// Resolve the user's full shell PATH for macOS packaged builds.
// Finder launches inherit launchd's minimal PATH, which excludes Homebrew,
// nvm, pyenv, and other tools installed in the user's shell profile.
if (process.platform === 'darwin' && app.isPackaged) {
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const fullPath = execSync(`${shell} -l -c 'printf "%s" "$PATH"'`, {
      encoding: 'utf-8',
      timeout: 5000
    })
    if (fullPath) process.env.PATH = fullPath
  } catch {
    // Fall back to existing PATH if shell resolution fails
  }
}

// Ensure LANG is set for proper UTF-8 handling in child processes
if (!process.env.LANG) {
  process.env.LANG = 'en_US.UTF-8'
}

const mcpLifecycle = new McpLifecycle()
const quitCoordinator = new QuitCoordinator()

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    // macOS vibrancy: shows blurred desktop content behind transparent regions
    ...(process.platform === 'darwin'
      ? {
          vibrancy: 'under-window' as const,
          visualEffectState: 'active' as const
        }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegrationInWorker: true,
      webviewTag: true
    }
  })

  setMainWindow(window)

  window.on('ready-to-show', () => {
    window.show()
  })

  window.on('closed', () => {
    if (getMainWindow() === window) {
      setMainWindow(null)
    }
  })

  window.webContents.setWindowOpenHandler((details) => {
    try {
      const url = new URL(details.url)
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        shell.openExternal(details.url)
      }
    } catch {
      // Invalid URL, ignore
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
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
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
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
  quitCoordinator.registerIpc()

  // Wire MCP server creation and agent monitoring to vault initialization.
  // Reads all .md files, builds VaultIndex + SearchEngine, then creates MCP
  // server with populated deps so search and graph queries return real data.
  // Wire MCP + agent services to vault initialization.
  // Services update on vault switch without re-registering IPC handlers.
  onVaultReady(async (vaultPath) => {
    const deps = await initVaultIndex(vaultPath)
    mcpLifecycle.createForVault(vaultPath, {
      ...deps,
      documentManager: getDocumentManager()
    })

    const monitor = TmuxMonitor.tryCreate(vaultPath)
    const spawner = new AgentSpawner(getShellService(), vaultPath)
    setAgentServices(monitor, spawner)
  })

  createWindow()
  registerWatcherIpc()
  registerShellIpc()

  registerDocumentIpc()
  registerProjectIpc()
  registerMcpIpc(mcpLifecycle)
  registerAgentIpc() // Register once at startup, services update via setAgentServices
  registerCanvasIpc()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Coordinated quit: block quit → signal renderer to flush vault state → flush documents → quit
let quitCleanupDone = false

app.on('before-quit', (event) => {
  if (quitCleanupDone) return // Cleanup already done, let quit proceed

  event.preventDefault() // Block quit until async cleanup completes

  const cleanup = async (): Promise<void> => {
    // Step 1: Signal renderer to flush vault state, wait up to 500ms
    await quitCoordinator.requestRendererFlush(() => getMainWindow(), 500)

    // Step 2: Flush all dirty documents
    await getDocumentManager().flushAll()

    // Step 3: Clean up services
    stopAgentServices()
    await mcpLifecycle.stop()
    getShellService().shutdown()
    getProjectWatcher().stop()
    getSessionTailer()?.stop()
  }

  cleanup().finally(() => {
    quitCleanupDone = true
    app.quit()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
