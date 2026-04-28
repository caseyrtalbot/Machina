/**
 * Connect manifest — tracks which vault files have been analyzed by /connect-vault.
 * Enables incremental runs: only new or changed files need AI judgment.
 *
 * Pure functions only. File I/O goes through the caller (window.api.fs).
 */

export interface FileEntry {
  readonly hash: string
  readonly analyzedAt: string // ISO 8601
}

export interface ConnectManifest {
  readonly version: 1
  readonly lastFullScan: string | null
  readonly files: Readonly<Record<string, FileEntry>>
}

interface ChangeSet {
  readonly newFiles: readonly string[]
  readonly changedFiles: readonly string[]
  readonly unchangedFiles: readonly string[]
  readonly removedFiles: readonly string[]
}

export function emptyManifest(): ConnectManifest {
  return { version: 1, lastFullScan: null, files: {} }
}

/**
 * Fast content hash using Web Crypto API (SHA-256).
 * Returns a hex string. Async because crypto.subtle.digest is async.
 */
export async function hashContent(content: string): Promise<string> {
  const encoded = new TextEncoder().encode(content)
  const buffer = await crypto.subtle.digest('SHA-256', encoded)
  const bytes = new Uint8Array(buffer)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Detect what changed between the manifest and the current vault state.
 *
 * @param manifest - Previous manifest (or null for first run)
 * @param currentHashes - Map of relative file paths to their content hashes
 */
export function detectChanges(
  manifest: ConnectManifest | null,
  currentHashes: ReadonlyMap<string, string>
): ChangeSet {
  const previous = manifest?.files ?? {}

  const newFiles: string[] = []
  const changedFiles: string[] = []
  const unchangedFiles: string[] = []

  for (const [path, hash] of currentHashes) {
    const entry = previous[path]
    if (!entry) {
      newFiles.push(path)
    } else if (entry.hash !== hash) {
      changedFiles.push(path)
    } else {
      unchangedFiles.push(path)
    }
  }

  const removedFiles = Object.keys(previous).filter((p) => !currentHashes.has(p))

  return { newFiles, changedFiles, unchangedFiles, removedFiles }
}

/**
 * Produce an updated manifest after analysis.
 * Merges analyzed file entries with the existing manifest,
 * removing entries for deleted files.
 */
export function updateManifest(
  previous: ConnectManifest | null,
  analyzedHashes: ReadonlyMap<string, string>,
  removedPaths: readonly string[],
  now: string
): ConnectManifest {
  const prevFiles = previous?.files ?? {}
  const updated: Record<string, FileEntry> = {}

  // Carry forward unchanged entries
  for (const [path, entry] of Object.entries(prevFiles)) {
    if (!removedPaths.includes(path)) {
      updated[path] = entry
    }
  }

  // Overwrite with newly analyzed entries
  for (const [path, hash] of analyzedHashes) {
    updated[path] = { hash, analyzedAt: now }
  }

  const isFullScan = previous === null
  return {
    version: 1,
    lastFullScan: isFullScan ? now : (previous?.lastFullScan ?? null),
    files: updated
  }
}
