import { webContents } from 'electron'

/**
 * SessionRouter maps terminal sessionIds to Electron webContentsIds.
 *
 * When terminal output arrives for a session, the router resolves the
 * correct webview process to forward data to. Destroyed webContents
 * are auto-cleaned on lookup.
 */

const sessionOwners = new Map<string, number>()

/** Bind a session to the webContents that owns it. */
export function register(sessionId: string, webContentsId: number): void {
  sessionOwners.set(sessionId, webContentsId)
}

/** Remove a session binding. */
export function unregister(sessionId: string): void {
  sessionOwners.delete(sessionId)
}

/**
 * Resolve the live webContents for a session.
 *
 * Returns null if the session is unknown, the webContents no longer
 * exists, or the webContents has been destroyed (auto-cleans the entry).
 */
export function getWebContents(sessionId: string): Electron.WebContents | null {
  const id = sessionOwners.get(sessionId)
  if (id === undefined) return null

  const wc = webContents.fromId(id)
  if (!wc || wc.isDestroyed()) {
    sessionOwners.delete(sessionId)
    return null
  }

  return wc
}

/** Remove all session bindings. */
export function clear(): void {
  sessionOwners.clear()
}
