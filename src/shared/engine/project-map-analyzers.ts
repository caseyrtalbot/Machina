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
