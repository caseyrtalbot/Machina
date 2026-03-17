import type { SessionId, VaultConfig, VaultState } from './types'

export interface IpcChannels {
  // --- Filesystem ---
  'fs:read-file': { request: { path: string }; response: string }
  'fs:write-file': { request: { path: string; content: string }; response: void }
  'fs:delete-file': { request: { path: string }; response: void }
  'fs:list-files': { request: { dir: string; pattern?: string }; response: string[] }
  'fs:list-files-recursive': { request: { dir: string }; response: string[] }
  'fs:file-exists': { request: { path: string }; response: boolean }
  'fs:select-vault': { request: void; response: string | null }
  'fs:rename-file': { request: { oldPath: string; newPath: string }; response: void }
  'fs:copy-file': { request: { srcPath: string; destPath: string }; response: void }
  'fs:create-folder': { request: { defaultPath: string }; response: string | null }
  'fs:mkdir': { request: { path: string }; response: void }
  'fs:read-binary': { request: { path: string }; response: string }
  'fs:list-all-files': { request: { dir: string }; response: string[] }

  // --- Vault ---
  'vault:read-config': { request: { vaultPath: string }; response: VaultConfig }
  'vault:write-config': { request: { vaultPath: string; config: VaultConfig }; response: void }
  'vault:read-state': { request: { vaultPath: string }; response: VaultState }
  'vault:write-state': { request: { vaultPath: string; state: VaultState }; response: void }
  'vault:init': { request: { vaultPath: string }; response: void }
  'vault:list-commands': { request: { dirPath: string }; response: string[] }
  'vault:read-file': { request: { filePath: string }; response: string }
  'vault:watch-start': { request: { vaultPath: string }; response: void }
  'vault:watch-stop': { request: void; response: void }

  // --- Shell ---
  'shell:show-in-folder': { request: { path: string }; response: void }
  'shell:open-path': { request: { path: string }; response: string }
  'shell:trash-item': { request: { path: string }; response: void }

  // --- Terminal ---
  'terminal:create': { request: { cwd: string; shell?: string }; response: SessionId }
  'terminal:write': { request: { sessionId: SessionId; data: string }; response: void }
  'terminal:resize': {
    request: { sessionId: SessionId; cols: number; rows: number }
    response: void
  }
  'terminal:kill': { request: { sessionId: SessionId }; response: void }
  'terminal:process-name': { request: { sessionId: SessionId }; response: string | null }

  // --- Window ---
  'window:minimize': { request: void; response: void }
  'window:maximize': { request: void; response: void }
  'window:close': { request: void; response: void }

  // --- Config ---
  'config:read': { request: { scope: string; key: string }; response: unknown }
  'config:write': { request: { scope: string; key: string; value: unknown }; response: void }
}

export interface IpcEvents {
  'terminal:data': { sessionId: SessionId; data: string }
  'terminal:exit': { sessionId: SessionId; code: number }
  'vault:file-changed': { path: string; event: 'add' | 'change' | 'unlink' }
}

export type IpcChannel = keyof IpcChannels
export type IpcRequest<C extends IpcChannel> = IpcChannels[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcChannels[C]['response']

export type IpcEvent = keyof IpcEvents
export type IpcEventData<E extends IpcEvent> = IpcEvents[E]
