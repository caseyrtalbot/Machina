/**
 * MCP IPC handlers: exposes MCP server status to the renderer process.
 *
 * The renderer can query whether the MCP server is running and how many
 * tools are registered, enabling status display in the UI.
 */
import { typedHandle } from '../typed-ipc'

export interface McpStatusProvider {
  isRunning(): boolean
  toolCount(): number
}

export function registerMcpIpc(provider: McpStatusProvider): void {
  typedHandle('mcp:status', () => ({
    running: provider.isRunning(),
    toolCount: provider.toolCount()
  }))
}
