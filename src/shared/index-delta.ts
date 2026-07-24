import type { Artifact } from './types'
import type { ParseError } from './engine/types'

/**
 * One file's contribution to the main-process index. `artifact` is null iff the
 * file failed to parse (in which case `error` carries the reason, and vice
 * versa). `path` is the canonical absolute path — the same namespace the
 * watcher and VaultIndex share.
 */
export interface VaultIndexEntry {
  path: string
  artifact: Artifact | null
  error: ParseError | null
}

/**
 * A parsed index change emitted after a watcher batch. `upserts` carry the
 * re-parsed entry for every added/changed .md file; `removes` are absolute
 * paths dropped from the index. The renderer consumes these instead of
 * re-parsing the same files (one parse authority: the main process).
 */
export interface VaultIndexDelta {
  upserts: VaultIndexEntry[]
  removes: string[]
}
