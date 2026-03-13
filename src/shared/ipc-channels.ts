import type { VaultConfig, VaultState } from './types'

export interface IpcChannels {
  'fs:read-file': { request: { path: string }; response: string }
  'fs:write-file': { request: { path: string; content: string }; response: void }
  'fs:delete-file': { request: { path: string }; response: void }
  'fs:list-files': { request: { dir: string; pattern?: string }; response: string[] }
  'fs:list-files-recursive': { request: { dir: string }; response: string[] }
  'fs:select-vault': { request: void; response: string | null }

  'vault:read-config': { request: { vaultPath: string }; response: VaultConfig }
  'vault:write-config': { request: { vaultPath: string; config: VaultConfig }; response: void }
  'vault:read-state': { request: { vaultPath: string }; response: VaultState }
  'vault:write-state': { request: { vaultPath: string; state: VaultState }; response: void }
  'vault:init': { request: { vaultPath: string }; response: void }

  'terminal:create': { request: { cwd: string; shell?: string }; response: string }
  'terminal:write': { request: { sessionId: string; data: string }; response: void }
  'terminal:resize': { request: { sessionId: string; cols: number; rows: number }; response: void }
  'terminal:kill': { request: { sessionId: string }; response: void }
  'terminal:process-name': { request: { sessionId: string }; response: string | null }

  'vault:git-branch': { request: { vaultPath: string }; response: string | null }

  // --- Window (new) ---
  'window:minimize': { request: void; response: void }
  'window:maximize': { request: void; response: void }
  'window:close': { request: void; response: void }

  // --- Config persistence (new) ---
  'config:read': { request: { scope: string; key: string }; response: unknown }
  'config:write': { request: { scope: string; key: string; value: unknown }; response: void }

  'vault:watch-start': { request: { vaultPath: string }; response: void }
  'vault:watch-stop': { request: void; response: void }
}

export interface IpcEvents {
  'terminal:data': { sessionId: string; data: string }
  'terminal:exit': { sessionId: string; code: number }
  'vault:file-changed': { path: string; event: 'add' | 'change' | 'unlink' }
}

export type IpcChannel = keyof IpcChannels
export type IpcRequest<C extends IpcChannel> = IpcChannels[C]['request']
export type IpcResponse<C extends IpcChannel> = IpcChannels[C]['response']
