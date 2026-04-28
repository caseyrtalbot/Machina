/**
 * MCP IPC handlers: exposes MCP server status to the renderer process.
 *
 * The renderer can query whether the MCP server is running and how many
 * tools are registered, enabling status display in the UI.
 */
import { ipcMain } from 'electron'

export interface McpStatusProvider {
  isRunning(): boolean
  toolCount(): number
}

interface McpStatus {
  readonly running: boolean
  readonly toolCount: number
}

export function registerMcpIpc(provider: McpStatusProvider): void {
  ipcMain.handle(
    'mcp:status',
    (): McpStatus => ({
      running: provider.isRunning(),
      toolCount: provider.toolCount()
    })
  )
}
