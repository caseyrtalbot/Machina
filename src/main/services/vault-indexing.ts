/**
 * Main-process vault indexing: builds VaultIndex + SearchEngine
 * from a list of file entries for MCP query support.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { VaultIndex } from '@shared/engine/indexer'
import { SearchEngine } from '@shared/engine/search-engine'
import type { VaultQueryDeps } from './vault-query-facade'

interface FileEntry {
  readonly path: string
  readonly content: string
}

/**
 * Build a VaultIndex and SearchEngine from file contents.
 * Files that fail to parse are silently skipped (errors recorded in VaultIndex).
 */
export function buildVaultDeps(files: readonly FileEntry[]): VaultQueryDeps & {
  readonly vaultIndex: VaultIndex
  readonly searchEngine: SearchEngine
} {
  const vaultIndex = new VaultIndex()

  for (const file of files) {
    vaultIndex.addFile(file.path, file.content)
  }

  const searchEngine = new SearchEngine()
  for (const artifact of vaultIndex.getArtifacts()) {
    const sourcePath = vaultIndex.getPathForArtifact(artifact.id)
    searchEngine.upsert({
      id: artifact.id,
      title: artifact.title,
      tags: [...artifact.tags],
      body: artifact.body,
      path: sourcePath ?? artifact.id
    })
  }

  return { vaultIndex, searchEngine }
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
export async function initVaultIndex(vaultRoot: string): Promise<
  VaultQueryDeps & {
    readonly vaultIndex: VaultIndex
    readonly searchEngine: SearchEngine
  }
> {
  const mdPaths = await listMdFiles(vaultRoot)

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
