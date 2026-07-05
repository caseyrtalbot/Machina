/**
 * Workspace primitive (workstation contracts §1).
 *
 * A workspace is any folder Machina opens; capabilities light up from folder
 * content. "A vault is a workspace with the knowledge capability enabled,
 * not the reverse."
 */

export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' }

export function workspaceId(id: string): WorkspaceId {
  return id as WorkspaceId
}

export type WorkspaceCapability = 'knowledge' | 'coding'

export interface Workspace {
  readonly id: WorkspaceId
  /** Canonicalized root (symlinks resolved, NFC) — same rule as vault:init. */
  readonly root: string
  readonly capabilities: readonly WorkspaceCapability[]
}
