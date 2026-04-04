import ignore, { type Ignore } from 'ignore'
import { readFile } from 'fs/promises'
import { join, relative } from 'path'

/**
 * Creates an ignore filter from patterns and optional gitignore content.
 * This is the pure, testable core. It does not perform I/O.
 */
export function createIgnoreFilter(
  defaultPatterns: readonly string[],
  customPatterns: readonly string[] = [],
  gitignoreContent: string | null = null
): Ignore {
  const ig = ignore()

  // Add default patterns
  ig.add([...defaultPatterns])

  // Add custom patterns from vault config
  if (customPatterns.length > 0) {
    ig.add([...customPatterns])
  }

  // Add .gitignore rules if content was provided
  if (gitignoreContent !== null) {
    ig.add(gitignoreContent)
  }

  return ig
}

/**
 * Creates an ignore filter that combines:
 * 1. Default ignore patterns (node_modules, .git, etc.)
 * 2. .gitignore rules from the vault root (if present)
 * 3. Custom patterns from vault config
 *
 * This is the I/O wrapper that reads .gitignore from disk.
 */
export async function loadGitignoreFilter(
  vaultPath: string,
  defaultPatterns: readonly string[],
  customPatterns: readonly string[] = []
): Promise<Ignore> {
  const gitignoreContent = await readGitignoreFile(join(vaultPath, '.gitignore'))
  return createIgnoreFilter(defaultPatterns, customPatterns, gitignoreContent)
}

/**
 * Reads a .gitignore file and returns its content, or null if it doesn't exist.
 */
async function readGitignoreFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Converts an absolute path to a vault-relative path with forward slashes,
 * suitable for use with the `ignore` package.
 */
export function toRelativeSlashPath(vaultPath: string, absolutePath: string): string {
  return relative(vaultPath, absolutePath)
}

/**
 * Returns true if the given absolute path should be ignored based on the filter.
 * Paths that resolve to the vault root itself are never ignored.
 */
export function shouldIgnore(ig: Ignore, vaultPath: string, absolutePath: string): boolean {
  const rel = toRelativeSlashPath(vaultPath, absolutePath)
  // Empty relative path means the vault root itself
  if (rel === '' || rel === '.') return false
  return ig.ignores(rel)
}
