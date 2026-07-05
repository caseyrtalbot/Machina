/**
 * WorkspaceService (workstation contracts §1).
 *
 * Replaces the module-level vault singleton in ipc/filesystem.ts. Phase 1
 * keeps exactly one active workspace; multi-workspace is not in contract.
 *
 * open() runs in load-bearing order: canonicalize → detect capabilities
 * (BEFORE scaffold — detection must never key on TE_DIR contents) →
 * PathGuard → initVault scaffold (unconditional; the renderer load path
 * hard-requires <TE_DIR>/config.json + state.json) → set current → ready
 * callbacks (sequential, awaited, rejections propagate to the caller).
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { TE_DIR } from '@shared/constants'
import { workspaceId, type Workspace, type WorkspaceCapability } from '@shared/workspace-types'
import { FileService } from './file-service'
import { PathGuard } from './path-guard'
import { canonicalizePath } from '../utils/paths'

/** Root-level manifests that mark a folder as a coding workspace. */
const CODING_MANIFESTS = ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod'] as const

/** Bounds for the markdown evidence walk. */
const EVIDENCE_MAX_DEPTH = 4
const EVIDENCE_MAX_ENTRIES = 5000

export interface CapabilityEvidence {
  /** Any .md file outside <TE_DIR>/ within the walk bounds. */
  readonly hasMarkdown: boolean
  /** A .git directory at the workspace root. */
  readonly hasGit: boolean
  /** A recognized manifest at the workspace root. */
  readonly hasManifest: boolean
}

/**
 * Pure capability classification: knowledge iff markdown outside TE_DIR;
 * coding iff .git or a root manifest; empty evidence defaults to
 * ['knowledge'] (preserves first-run UX for an empty folder).
 */
export function classifyCapabilities(evidence: CapabilityEvidence): readonly WorkspaceCapability[] {
  const capabilities: WorkspaceCapability[] = []
  if (evidence.hasMarkdown) capabilities.push('knowledge')
  if (evidence.hasGit || evidence.hasManifest) capabilities.push('coding')
  return capabilities.length > 0 ? capabilities : ['knowledge']
}

/**
 * Bounded evidence walk for markdown: depth ≤ 4, ~5000 entries, skipping
 * TE_DIR, dot-directories (covers .git and both .machina variants), and
 * node_modules; stops at the first hit. Root-level .git/manifest checks are
 * O(1) lookups, not part of the walk.
 */
export function collectEvidence(root: string): CapabilityEvidence {
  const hasGit = existsSync(join(root, '.git'))
  const hasManifest = CODING_MANIFESTS.some((name) => existsSync(join(root, name)))

  let entriesSeen = 0
  const hasMarkdownIn = (dir: string, depth: number): boolean => {
    if (depth > EVIDENCE_MAX_DEPTH || entriesSeen >= EVIDENCE_MAX_ENTRIES) return false
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return false
    }
    const subdirs: string[] = []
    for (const entry of entries) {
      if (entriesSeen >= EVIDENCE_MAX_ENTRIES) return false
      entriesSeen++
      if (entry.isDirectory()) {
        if (entry.name === TE_DIR || entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue
        }
        subdirs.push(join(dir, entry.name))
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        return true
      }
    }
    return subdirs.some((sub) => hasMarkdownIn(sub, depth + 1))
  }

  return { hasGit, hasManifest, hasMarkdown: hasMarkdownIn(root, 0) }
}

export class WorkspaceService {
  private activeWorkspace: Workspace | null = null
  private activeGuard: PathGuard | null = null
  private readonly readyCallbacks: Array<(ws: Workspace) => void | Promise<void>> = []
  /** Serializes open() calls — see the re-entrancy note on open(). */
  private openChain: Promise<unknown> = Promise.resolve()

  constructor(private readonly fileService: FileService = new FileService()) {}

  /**
   * Canonicalize, detect capabilities, build PathGuard, scaffold, fire ready
   * callbacks. Calls are serialized in arrival order: ready callbacks
   * reconfigure shared process state (index, MCP lifecycle, health, agents),
   * so two interleaved opens could leave services split across roots, with
   * the slower open overwriting the newer one. The last CALLER wins, not the
   * last finisher. A failed open does not poison the chain.
   */
  async open(path: string): Promise<Workspace> {
    const run = this.openChain.then(() => this.doOpen(path))
    this.openChain = run.catch(() => undefined)
    return run
  }

  private async doOpen(path: string): Promise<Workspace> {
    const root = canonicalizePath(path)
    // Detect BEFORE scaffold: initVault creates TE_DIR unconditionally, and
    // detection must never key on TE_DIR contents (a once-opened coding repo
    // would otherwise reclassify on reopen).
    const capabilities = classifyCapabilities(collectEvidence(root))
    const guard = new PathGuard(root)
    await this.fileService.initVault(root)
    const workspace: Workspace = { id: workspaceId(root), root, capabilities }
    this.activeWorkspace = workspace
    this.activeGuard = guard
    for (const cb of this.readyCallbacks) {
      await cb(workspace)
    }
    return workspace
  }

  current(): Workspace | null {
    return this.activeWorkspace
  }

  /** The one PathGuard for the active workspace — same object every caller sees. */
  guard(): PathGuard {
    if (!this.activeGuard) {
      throw new Error('guard() called before workspace:open')
    }
    return this.activeGuard
  }

  /** Replaces the old filesystem.ts vault-ready hook. Callbacks run sequentially inside open(). */
  onReady(cb: (ws: Workspace) => void | Promise<void>): void {
    this.readyCallbacks.push(cb)
  }
}

let workspaceService: WorkspaceService | null = null

export function getWorkspaceService(): WorkspaceService {
  if (!workspaceService) {
    workspaceService = new WorkspaceService()
  }
  return workspaceService
}
