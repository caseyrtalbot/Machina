/**
 * Project-map analyzers: pure functions for extracting file relationships.
 * Zero dependencies beyond project-map-types. Worker-safe.
 */

// ─── Import Extraction ──────────────────────────────────────────────

/**
 * Extract relative import/require specifiers from JS/TS source code.
 * Only returns specifiers starting with './' or '../'.
 */
export function extractImportSpecifiers(code: string): readonly string[] {
  const specifiers: string[] = []

  const esImportRe = /(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = esImportRe.exec(code)) !== null) {
    const spec = match[1]
    if (spec.startsWith('./') || spec.startsWith('../')) {
      specifiers.push(spec)
    }
  }

  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((match = dynamicRe.exec(code)) !== null) {
    const spec = match[1]
    if ((spec.startsWith('./') || spec.startsWith('../')) && !specifiers.includes(spec)) {
      specifiers.push(spec)
    }
  }

  const requireRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((match = requireRe.exec(code)) !== null) {
    const spec = match[1]
    if ((spec.startsWith('./') || spec.startsWith('../')) && !specifiers.includes(spec)) {
      specifiers.push(spec)
    }
  }

  return specifiers
}

// ─── Path Resolution ──────────────────────────────────────────────

import * as path from 'path'

const EXTENSION_PRIORITY = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md'] as const
const INDEX_PRIORITY = EXTENSION_PRIORITY.map((ext) => `index${ext}`)

/**
 * Resolve a single import specifier to an absolute file path.
 * Returns null if: bare specifier, outside root, or no file match.
 */
export function resolveImportPath(
  specifier: string,
  importingFile: string,
  allFilePaths: ReadonlySet<string>,
  rootPath: string
): string | null {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null

  const resolved = path.resolve(path.dirname(importingFile), specifier)

  if (!resolved.startsWith(rootPath + '/') && resolved !== rootPath) return null

  const hasExtension = path.extname(specifier) !== ''
  if (hasExtension) {
    return allFilePaths.has(resolved) ? resolved : null
  }

  for (const ext of EXTENSION_PRIORITY) {
    const candidate = resolved + ext
    if (allFilePaths.has(candidate)) return candidate
  }

  for (const indexFile of INDEX_PRIORITY) {
    const candidate = path.join(resolved, indexFile)
    if (allFilePaths.has(candidate)) return candidate
  }

  return null
}
