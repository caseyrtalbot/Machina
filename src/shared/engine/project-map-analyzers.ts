/**
 * Project-map analyzers: pure functions for extracting file relationships.
 * Zero dependencies beyond project-map-types. Worker-safe.
 */

import type {
  ProjectMapEdge,
  ProjectMapNode,
  ProjectMapOptions,
  ProjectMapSnapshot
} from './project-map-types'
import type { CanvasNodeType } from '../canvas-types'
import { stableNodeId, isBinaryPath } from './project-map-types'
import * as path from './posix-path'

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

  if (allFilePaths.has(resolved)) {
    return resolved
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

// ─── Markdown Reference Extraction ──────────────────────────────────

/**
 * Extract references from markdown content: wikilinks and relative links.
 * Wikilinks return the target name; relative links return the href.
 */
export function extractMarkdownRefs(content: string): readonly string[] {
  const refs: string[] = []

  const wikilinkRe = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
  let match: RegExpExecArray | null
  while ((match = wikilinkRe.exec(content)) !== null) {
    refs.push(match[1])
  }

  const mdLinkRe = /\[(?:[^\]]*)\]\((\.[^)]+)\)/g
  while ((match = mdLinkRe.exec(content)) !== null) {
    const href = match[1]
    if (href.startsWith('./') || href.startsWith('../')) {
      refs.push(href)
    }
  }

  return refs
}

// ─── Config Path Reference Extraction ────────────────────────────────

/**
 * Extract relative path references from config files (JSON, YAML).
 * Returns specifiers starting with './' or '../'.
 */
export function extractConfigPathRefs(content: string): readonly string[] {
  const refs: string[] = []

  const quotedPathRe = /["'](\.\.\/.+?|\.\/[^"']+?)["']/g
  let match: RegExpExecArray | null
  while ((match = quotedPathRe.exec(content)) !== null) {
    refs.push(match[1])
  }

  const yamlPathRe = /:\s+(\.\.\/.+|\.\/\S+)/g
  while ((match = yamlPathRe.exec(content)) !== null) {
    const val = match[1]
    if (!refs.includes(val)) refs.push(val)
  }

  return refs
}

// ─── File Type Detection ─────────────────────────────────────────────

const TS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const MD_EXTENSIONS = new Set(['.md', '.mdx'])
const CONFIG_EXTENSIONS = new Set(['.json', '.yaml', '.yml', '.toml'])

function inferNodeType(_filePath: string): CanvasNodeType {
  // All files in a folder map render as compact project-file cards,
  // not full NoteCards. The card shows file name + metadata, not content.
  return 'project-file'
}

// ─── Wikilink Resolution ──────────────────────────────────────────────

function resolveWikilink(
  target: string,
  allFilePaths: ReadonlySet<string>,
  rootPath: string
): string | null {
  const normalized = target.toLowerCase()
  for (const fp of allFilePaths) {
    if (!fp.startsWith(rootPath)) continue
    const stem = path.basename(fp, path.extname(fp)).toLowerCase()
    if (stem === normalized) return fp
  }
  return null
}

// ─── Snapshot Builder ──────────────────────────────────────────────

export interface FileInput {
  readonly path: string
  readonly content: string | null
  readonly error?: string
}

/**
 * Build a ProjectMapSnapshot from a root path and file contents.
 * Pure function, no I/O. Extracts containment, imports, and references.
 */
export function buildProjectMapSnapshot(
  rootPath: string,
  files: readonly FileInput[],
  options: ProjectMapOptions
): ProjectMapSnapshot {
  const allFilePaths = new Set(
    files.filter((f) => f.content !== null && !f.error).map((f) => f.path)
  )
  const edges: ProjectMapEdge[] = []
  const unresolvedRefs: string[] = []
  let skippedCount = 0

  // Track directories we've seen
  const dirNodes = new Map<string, ProjectMapNode & { children: string[] }>()

  function ensureDirNode(dirPath: string, depth: number): ProjectMapNode & { children: string[] } {
    const existing = dirNodes.get(dirPath)
    if (existing) return existing
    const relativePath = dirPath === rootPath ? '' : path.relative(rootPath, dirPath)
    const node: ProjectMapNode & { children: string[] } = {
      id: stableNodeId(rootPath, relativePath || '.'),
      relativePath: relativePath || '.',
      name: path.basename(dirPath) || path.basename(rootPath),
      isDirectory: true,
      nodeType: 'project-folder' as CanvasNodeType,
      depth,
      lineCount: 0,
      children: [],
      childCount: 0
    }
    dirNodes.set(dirPath, node)
    return node
  }

  function linkParentChain(filePath: string, childId: string | null, depth: number): void {
    let parentPath = path.dirname(filePath)
    let nextChildId = childId
    let nextChildPath = filePath
    let parentDepth = depth - 1

    while (parentPath.length >= rootPath.length) {
      const parentNode = ensureDirNode(parentPath, parentDepth)
      if (nextChildId && !parentNode.children.includes(nextChildId)) {
        parentNode.children.push(nextChildId)
      }

      if (parentPath === rootPath) break

      nextChildPath = parentPath
      nextChildId = dirNodes.get(nextChildPath)?.id ?? null
      parentPath = path.dirname(parentPath)
      parentDepth--
    }
  }

  // Build directory tree + file nodes
  const fileNodes = new Map<string, ProjectMapNode>()
  ensureDirNode(rootPath, 0)

  for (const file of files) {
    const relativePath = path.relative(rootPath, file.path)
    const depth = relativePath === '.' ? 1 : relativePath.split(path.sep).length

    if (file.content === null || file.error) {
      skippedCount++
      linkParentChain(file.path, null, depth)
      continue
    }

    if (isBinaryPath(file.path)) {
      skippedCount++
      linkParentChain(file.path, null, depth)
      continue
    }

    const lineCount = file.content.split('\n').length

    const node: ProjectMapNode = {
      id: stableNodeId(rootPath, relativePath),
      relativePath,
      name: path.basename(file.path),
      isDirectory: false,
      nodeType: inferNodeType(file.path),
      depth,
      lineCount,
      children: [],
      childCount: 0
    }
    fileNodes.set(file.path, node)

    linkParentChain(file.path, node.id, depth)
  }

  // Collect all nodes, respecting maxNodes
  const allDirNodes = [...dirNodes.values()]
  const allFileNodes = [...fileNodes.values()]
  const totalFileCount = files.length

  // Sort by depth for breadth-first truncation
  const sortedNodes = [...allDirNodes, ...allFileNodes].sort((a, b) => a.depth - b.depth)

  const truncated = sortedNodes.length > options.maxNodes
  const includedNodes = sortedNodes.slice(0, options.maxNodes)
  const includedIds = new Set(includedNodes.map((n) => n.id))

  // Freeze nodes as immutable ProjectMapNode (filter children to included set)
  const frozenNodes: ProjectMapNode[] = includedNodes.map((n) => {
    const dirEntry = dirNodes.get(
      n.isDirectory
        ? n.relativePath === '.'
          ? rootPath
          : path.resolve(rootPath, n.relativePath)
        : ''
    )
    const mutableChildren = dirEntry ? dirEntry.children : []
    return {
      ...n,
      childCount: n.isDirectory ? mutableChildren.length : 0,
      children: n.isDirectory ? mutableChildren.filter((id) => includedIds.has(id)) : []
    }
  })

  // Build containment edges
  for (const dirNode of allDirNodes) {
    if (!includedIds.has(dirNode.id)) continue
    for (const childId of dirNode.children) {
      if (includedIds.has(childId)) {
        edges.push({ source: dirNode.id, target: childId, kind: 'contains' })
      }
    }
  }

  // Build import/reference edges
  for (const file of files) {
    if (file.content === null || file.error || isBinaryPath(file.path)) continue
    const sourceNode = fileNodes.get(file.path)
    if (!sourceNode || !includedIds.has(sourceNode.id)) continue

    const ext = file.path.slice(file.path.lastIndexOf('.')).toLowerCase()

    // TS/JS imports
    if (TS_EXTENSIONS.has(ext)) {
      const specifiers = extractImportSpecifiers(file.content)
      for (const spec of specifiers) {
        const resolved = resolveImportPath(spec, file.path, allFilePaths, rootPath)
        if (resolved) {
          const targetNode = fileNodes.get(resolved)
          if (targetNode && includedIds.has(targetNode.id)) {
            edges.push({ source: sourceNode.id, target: targetNode.id, kind: 'imports' })
          }
        } else {
          unresolvedRefs.push(`${sourceNode.relativePath}: ${spec}`)
        }
      }
    }

    // Markdown refs
    if (MD_EXTENSIONS.has(ext)) {
      const refs = extractMarkdownRefs(file.content)
      for (const ref of refs) {
        // Try as relative path first
        if (ref.startsWith('./') || ref.startsWith('../')) {
          const resolved = resolveImportPath(ref, file.path, allFilePaths, rootPath)
          if (resolved) {
            const targetNode = fileNodes.get(resolved)
            if (targetNode && includedIds.has(targetNode.id)) {
              edges.push({ source: sourceNode.id, target: targetNode.id, kind: 'references' })
            }
          } else {
            unresolvedRefs.push(`${sourceNode.relativePath}: ${ref}`)
          }
        } else {
          // Wikilink -- resolve by filename stem
          const resolved = resolveWikilink(ref, allFilePaths, rootPath)
          if (resolved) {
            const targetNode = fileNodes.get(resolved)
            if (targetNode && includedIds.has(targetNode.id)) {
              edges.push({ source: sourceNode.id, target: targetNode.id, kind: 'references' })
            }
          } else {
            unresolvedRefs.push(`${sourceNode.relativePath}: [[${ref}]]`)
          }
        }
      }
    }

    // Config path refs
    if (CONFIG_EXTENSIONS.has(ext)) {
      const refs = extractConfigPathRefs(file.content)
      for (const ref of refs) {
        const resolved = resolveImportPath(ref, file.path, allFilePaths, rootPath)
        if (resolved) {
          const targetNode = fileNodes.get(resolved)
          if (targetNode && includedIds.has(targetNode.id)) {
            edges.push({ source: sourceNode.id, target: targetNode.id, kind: 'references' })
          }
        }
        // Config refs that don't resolve are silently ignored
      }
    }
  }

  return {
    rootPath,
    nodes: frozenNodes,
    edges,
    truncated,
    totalFileCount,
    skippedCount,
    unresolvedRefs
  }
}
