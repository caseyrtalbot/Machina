/**
 * Main-process vault indexing: builds VaultIndex + SearchEngine
 * from a list of file entries for MCP query support, and keeps them
 * live as vault files change (watcher batches + agent writes).
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { VaultIndex } from '@shared/engine/indexer'
import { SearchEngine } from '@shared/engine/search-engine'
import { TE_DIR } from '@shared/constants'
import { SYSTEM_ARTIFACT_DIRECTORIES } from '@shared/system-artifacts'
import type { VaultIndexEntry, VaultIndexDelta } from '@shared/index-delta'
import type { VaultQueryDeps } from './vault-query-facade'

interface FileEntry {
  readonly path: string
  readonly content: string
}

export interface LiveIndexDeps {
  readonly vaultIndex: VaultIndex
  readonly searchEngine: SearchEngine
  /** Per-path parsed entries backing the index snapshot served over IPC. */
  readonly entriesByPath: Map<string, VaultIndexEntry>
}

/**
 * Subset of the deps needed to mutate the index for a single file. The
 * entriesByPath map is optional so the facade's read-your-writes path (which
 * only holds vaultIndex + searchEngine) can reuse this without the snapshot
 * map; the watcher echo carries the snapshot update for those writes.
 */
interface ApplyDeps {
  readonly vaultIndex: VaultIndex
  readonly searchEngine: SearchEngine
  readonly entriesByPath?: Map<string, VaultIndexEntry>
}

export interface IndexFileEvent {
  readonly path: string
  readonly event: 'add' | 'change' | 'unlink'
}

/**
 * Parse one file into the VaultIndex and mirror the result into the
 * SearchEngine, replacing any prior entry for the same path. If the file's
 * artifact id changed (frontmatter id edit), the stale search doc keyed by
 * the old id is removed; if the new content fails to parse, the file drops
 * out of the search index (but is retained in the snapshot as a parse error).
 * Returns the resulting snapshot entry.
 */
export function applyFileToIndex(deps: ApplyDeps, path: string, content: string): VaultIndexEntry {
  const oldId = deps.vaultIndex.getIdForFile(path)
  const { artifact, error } = deps.vaultIndex.updateFile(path, content)
  const newId = artifact?.id

  if (oldId && oldId !== newId) {
    deps.searchEngine.remove(oldId)
  }
  if (artifact) {
    deps.searchEngine.upsert({
      id: artifact.id,
      title: artifact.title,
      tags: [...artifact.tags],
      body: artifact.body,
      path
    })
  }

  const entry: VaultIndexEntry = { path, artifact: artifact ?? null, error }
  deps.entriesByPath?.set(path, entry)
  return entry
}

/** Remove a file from the VaultIndex, SearchEngine, and snapshot map. */
export function removeFileFromIndex(deps: ApplyDeps, path: string): void {
  const id = deps.vaultIndex.getIdForFile(path)
  deps.vaultIndex.removeFile(path)
  if (id) deps.searchEngine.remove(id)
  deps.entriesByPath?.delete(path)
}

/**
 * Apply a watcher batch to the index and return the delta it produced. Reads
 * changed .md files from disk; a read failure (e.g. deleted between batch and
 * read) drops the file from the index. Non-markdown paths are ignored.
 */
export async function applyIndexEvents(
  deps: LiveIndexDeps,
  events: readonly IndexFileEvent[]
): Promise<VaultIndexDelta> {
  const upserts: VaultIndexEntry[] = []
  const removes: string[] = []
  for (const { path, event } of events) {
    if (extname(path).toLowerCase() !== '.md') continue
    if (event === 'unlink') {
      removeFileFromIndex(deps, path)
      removes.push(path)
      continue
    }
    try {
      const content = await readFile(path, 'utf-8')
      upserts.push(applyFileToIndex(deps, path, content))
    } catch {
      removeFileFromIndex(deps, path)
      removes.push(path)
    }
  }
  return { upserts, removes }
}

/**
 * Fire-and-forget watcher subscriber that keeps the main-process index live.
 * Batches are serialized through an internal promise chain so two overlapping
 * batches cannot interleave reads against the same path. When `onDelta` is
 * supplied, it is invoked with each batch's parsed delta after it applies, in
 * batch order (inside the serialization chain).
 */
export function createLiveIndexUpdater(
  deps: LiveIndexDeps,
  onDelta?: (delta: VaultIndexDelta) => void
): (events: readonly IndexFileEvent[]) => void {
  let queue: Promise<void> = Promise.resolve()
  return (events) => {
    queue = queue
      .then(async () => {
        const delta = await applyIndexEvents(deps, events)
        if (delta.upserts.length > 0 || delta.removes.length > 0) onDelta?.(delta)
      })
      .catch(() => {})
  }
}

/** Immutable copy of the current index snapshot for IPC delivery. */
export function getIndexSnapshot(deps: LiveIndexDeps): { entries: VaultIndexEntry[] } {
  return { entries: [...deps.entriesByPath.values()] }
}

/**
 * Build a VaultIndex and SearchEngine from file contents.
 * Files that fail to parse are retained in the snapshot as parse errors.
 */
export function buildVaultDeps(files: readonly FileEntry[]): VaultQueryDeps & LiveIndexDeps {
  const deps: LiveIndexDeps = {
    vaultIndex: new VaultIndex(),
    searchEngine: new SearchEngine(),
    entriesByPath: new Map<string, VaultIndexEntry>()
  }
  for (const file of files) {
    applyFileToIndex(deps, file.path, file.content)
  }
  return deps
}

/**
 * Recursively list all .md files under a directory, skipping hidden dirs.
 */
async function listMdFiles(dir: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const results: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await listMdFiles(fullPath)))
    } else if (entry.isFile() && extname(entry.name) === '.md') {
      results.push(fullPath)
    }
  }
  return results
}

/** Concurrency limit for file reads. */
const READ_CONCURRENCY = 12

/**
 * Read all .md files from a vault directory and build a VaultIndex + SearchEngine.
 * Uses bounded concurrency to avoid overwhelming IPC/disk on large vaults.
 */
export async function initVaultIndex(vaultRoot: string): Promise<VaultQueryDeps & LiveIndexDeps> {
  // System artifacts (sessions/patterns/tensions) live under the hidden TE dir,
  // which listMdFiles skips. Scan their directories explicitly so the main
  // index is the single authority over the whole corpus, not just user notes.
  const artifactsBase = join(vaultRoot, TE_DIR, 'artifacts')
  const systemDirs = Object.values(SYSTEM_ARTIFACT_DIRECTORIES).map((dir) =>
    join(artifactsBase, dir)
  )
  const systemPaths = (await Promise.all(systemDirs.map(listMdFiles))).flat()
  const mdPaths = [...(await listMdFiles(vaultRoot)), ...systemPaths]

  // Bounded concurrency file reads
  const files: FileEntry[] = []
  const pending: Promise<void>[] = []

  for (const filePath of mdPaths) {
    const task = readFile(filePath, 'utf-8')
      .then((content) => {
        files.push({ path: filePath, content })
      })
      .catch(() => {
        // Skip files that can't be read
      })
    pending.push(task)

    if (pending.length >= READ_CONCURRENCY) {
      await Promise.all(pending)
      pending.length = 0
    }
  }
  if (pending.length > 0) {
    await Promise.all(pending)
  }

  return buildVaultDeps(files)
}
