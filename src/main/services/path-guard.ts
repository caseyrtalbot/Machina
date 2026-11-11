/**
 * PathGuard enforces vault-scoped file access.
 *
 * All file paths are resolved (including symlinks) and checked against
 * the vault root before any I/O is allowed. A deny list blocks access
 * to sensitive directories regardless of location.
 */

import { PathGuardError } from '@shared/agent-types'
import { resolve, relative } from 'node:path'
import { canonicalizePath } from '../utils/paths'

/** Exact segment names that are always denied, even inside the vault. */
const DENY_LIST = new Set(['.git', '.ssh', 'node_modules', '.ds_store'])

/**
 * Dotenv-family files are always denied: `.env`, `.env.local`, `.env.production`,
 * etc. A pattern (not an exact-name set entry) so the whole family is caught
 * while ordinary names like `environment.md` stay permitted. Strictly tightens
 * the deny list — never newly permits anything.
 */
const DOTENV_SEGMENT_RE = /^\.env(\.|$)/

/**
 * Stateless path guard bound to a specific vault root.
 *
 * Create one instance per active vault. All methods are synchronous
 * because path validation must complete before any I/O begins.
 */
export class PathGuard {
  private readonly resolvedRoot: string
  private readonly requestedRoot: string

  constructor(vaultRoot: string) {
    this.resolvedRoot = canonicalizePath(vaultRoot)
    this.requestedRoot = resolve(vaultRoot.normalize('NFC'))
  }

  /**
   * Resolve a file path and verify it falls within the vault root.
   *
   * @returns The fully-resolved, normalized path.
   * @throws PathGuardError if the path is outside the vault, contains
   *         null bytes, or matches the deny list.
   */
  assertWithinVault(filePath: string): string {
    this.rejectNullBytes(filePath)

    const normalized = this.normalizePath(filePath)
    // Check the requested name too: a .env symlink must not become readable
    // merely because it resolves to an otherwise permitted note.
    const lexical = resolve(normalized)
    const requestedRelative = relative(this.requestedRoot, lexical)
    // A vault may itself be opened through a symlink (including /var on macOS).
    // Resolve the boundary below; inspect lexical segments without requiring
    // the caller to already know the canonical root spelling.
    this.checkSegments(requestedRelative)
    const resolved = this.resolvePath(normalized)

    this.checkBoundary(resolved)
    this.checkDenyList(resolved)

    return resolved
  }

  // -- Private helpers (each does one check, throws on failure) --

  private rejectNullBytes(filePath: string): void {
    if (filePath.includes('\0')) {
      throw new PathGuardError(filePath, this.resolvedRoot, 'Path contains null bytes')
    }
  }

  /**
   * NFC-normalize and resolve the path. Unicode normalization prevents
   * macOS NFD decomposition from creating distinct-looking paths that
   * resolve to the same file.
   */
  private normalizePath(filePath: string): string {
    return filePath.normalize('NFC')
  }

  /**
   * Resolve the path to an absolute form, following symlinks when
   * the target exists on disk.
   */
  private resolvePath(filePath: string): string {
    return canonicalizePath(filePath)
  }

  private checkBoundary(resolved: string): void {
    const normalizedResolved = resolved.normalize('NFC')
    const normalizedRoot = this.resolvedRoot.normalize('NFC')

    if (
      normalizedResolved !== normalizedRoot &&
      !normalizedResolved.startsWith(normalizedRoot + '/')
    ) {
      throw new PathGuardError(resolved, this.resolvedRoot, 'Path is outside vault boundary')
    }
  }

  private checkDenyList(resolved: string): void {
    // Split the path relative to vault root and check each segment.
    this.checkSegments(relative(this.resolvedRoot, resolved))
  }

  private checkSegments(path: string): void {
    const segments = path.split('/')

    for (const segment of segments) {
      if (DENY_LIST.has(segment.toLowerCase()) || DOTENV_SEGMENT_RE.test(segment.toLowerCase())) {
        throw new PathGuardError(
          path,
          this.resolvedRoot,
          `Path contains denied segment: ${segment}`
        )
      }
    }
  }
}
