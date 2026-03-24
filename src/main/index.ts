import { app, shell, BrowserWindow, session } from 'electron'
import { execSync } from 'child_process'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerFilesystemIpc } from './ipc/filesystem'
import { registerWatcherIpc } from './ipc/watcher'
import { registerShellIpc, getShellService } from './ipc/shell'
import { registerConfigIpc } from './ipc/config'

import { registerProjectIpc, getProjectWatcher, getSessionTailer } from './ipc/workbench'
import { registerDocumentIpc, getDocumentManager } from './ipc/documents'
import { typedHandle } from './typed-ipc'

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

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
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
      nodeIntegrationInWorker: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
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
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function registerWindowIpc(): void {
  typedHandle('window:minimize', () => {
    mainWindow?.minimize()
  })
  typedHandle('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  typedHandle('window:close', () => {
    mainWindow?.close()
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

  const window = createWindow()
  registerWatcherIpc(window)
  registerShellIpc(window)

  registerDocumentIpc(window)
  registerProjectIpc(window)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', async () => {
  // Flush all dirty documents before quitting
  await getDocumentManager().flushAll()

  getShellService().killAll()

  getProjectWatcher().stop()
  getSessionTailer()?.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
