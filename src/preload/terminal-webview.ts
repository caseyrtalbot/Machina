import { contextBridge, ipcRenderer } from 'electron'

type DataPayload = { sessionId: string; data: string }
type ExitPayload = { sessionId: string; code: number }

const dataListeners = new Set<(data: DataPayload) => void>()
const exitListeners = new Set<(data: ExitPayload) => void>()

ipcRenderer.on('terminal:data', (_event, data: DataPayload) => {
  for (const cb of dataListeners) {
    cb(data)
  }
})

ipcRenderer.on('terminal:exit', (_event, data: ExitPayload) => {
  for (const cb of exitListeners) {
    cb(data)
  }
})

const terminalApi = {
  create: (args: { cwd: string; shell?: string; label?: string; vaultPath?: string }) =>
    ipcRenderer.invoke('terminal:create', args),

  write: (args: { sessionId: string; data: string }) => ipcRenderer.invoke('terminal:write', args),

  resize: (args: { sessionId: string; cols: number; rows: number }) =>
    ipcRenderer.invoke('terminal:resize', args),

  kill: (args: { sessionId: string }) => ipcRenderer.invoke('terminal:kill', args),

  reconnect: (args: { sessionId: string; cols: number; rows: number }) =>
    ipcRenderer.invoke('terminal:reconnect', args),

  onData: (cb: (data: DataPayload) => void) => {
    dataListeners.add(cb)
  },

  offData: (cb: (data: DataPayload) => void) => {
    dataListeners.delete(cb)
  },

  onExit: (cb: (data: ExitPayload) => void) => {
    exitListeners.add(cb)
  },

  offExit: (cb: (data: ExitPayload) => void) => {
    exitListeners.delete(cb)
  },

  onFocus: (cb: () => void) => {
    ipcRenderer.on('focus', cb)
  },

  onBlur: (cb: () => void) => {
    ipcRenderer.on('blur', cb)
  },

  sendToHost: (channel: string, ...args: unknown[]) => ipcRenderer.sendToHost(channel, ...args)
}

contextBridge.exposeInMainWorld('terminalApi', terminalApi)

export type TerminalWebviewApi = typeof terminalApi
