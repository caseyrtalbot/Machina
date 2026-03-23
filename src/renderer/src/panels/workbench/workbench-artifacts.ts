import type { CanvasEdge, CanvasFile, CanvasNode } from '@shared/canvas-types'
import { TE_DIR } from '@shared/constants'
import type {
  WorkbenchSessionEvent,
  SessionMilestone,
  SessionToolEvent
} from '@shared/workbench-types'
import type {
  PatternArtifactFrontmatter,
  SessionArtifactFrontmatter,
  SystemArtifactSection,
  TensionArtifactFrontmatter
} from '@shared/system-artifacts'
import { renderSystemArtifactDocument, slugifyArtifactPart } from '@shared/system-artifacts'

const EPHEMERAL_METADATA_KEYS = new Set(['isActive', 'initialCwd', 'initialCommand'])

function dateStampForId(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, '0')
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  const hours = `${date.getHours()}`.padStart(2, '0')
  const minutes = `${date.getMinutes()}`.padStart(2, '0')
  return `${year}${month}${day}-${hours}${minutes}`
}

function dateOnly(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, '0')}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
}

function isoStringFromTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString()
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))]
}

function relativeToProject(filePath: string, projectPath: string): string {
  if (filePath.startsWith(projectPath + '/')) {
    return filePath.slice(projectPath.length + 1)
  }
  return filePath
}

function cleanNode(node: CanvasNode): CanvasNode {
  const metadata = Object.fromEntries(
    Object.entries(node.metadata).filter(([key]) => !EPHEMERAL_METADATA_KEYS.has(key))
  )
  return { ...node, metadata }
}

function selectionEdges(
  selectedNodeIds: ReadonlySet<string>,
  edges: readonly CanvasEdge[]
): CanvasEdge[] {
  return edges.filter(
    (edge) => selectedNodeIds.has(edge.fromNode) && selectedNodeIds.has(edge.toNode)
  )
}

function selectedProjectFileRefs(nodes: readonly CanvasNode[], projectPath: string): string[] {
  return uniqueStrings(
    nodes.flatMap((node) => {
      if (node.type !== 'project-file') return []
      const metadata = node.metadata as Record<string, unknown>
      const relativePath =
        typeof metadata.relativePath === 'string'
          ? metadata.relativePath
          : typeof metadata.filePath === 'string'
            ? relativeToProject(metadata.filePath, projectPath)
            : ''
      return relativePath ? [relativePath] : []
    })
  )
}

function selectedNoteRefs(nodes: readonly CanvasNode[], projectPath: string): string[] {
  return uniqueStrings(
    nodes.flatMap((node) => {
      if ((node.type !== 'note' && node.type !== 'markdown') || !node.content) return []
      return [relativeToProject(node.content, projectPath)]
    })
  )
}

function selectedLaunchTerminals(
  nodes: readonly CanvasNode[]
): PatternArtifactFrontmatter['launch']['terminals'] {
  return nodes.flatMap((node) => {
    if (node.type !== 'terminal') return []
    const metadata = node.metadata as Record<string, unknown>
    const cwd =
      typeof metadata.initialCwd === 'string' && metadata.initialCwd.length > 0
        ? metadata.initialCwd
        : '.'
    const command =
      typeof metadata.initialCommand === 'string' && metadata.initialCommand.length > 0
        ? metadata.initialCommand
        : undefined
    const title =
      typeof metadata.title === 'string' && metadata.title.length > 0 ? metadata.title : undefined
    return [{ cwd, command, title }]
  })
}

function formatMilestoneEvent(event: SessionToolEvent, projectPath: string): string {
  if (event.filePath) {
    return `${event.tool} ${relativeToProject(event.filePath, projectPath)}`
  }
  return event.detail ? `${event.tool} ${event.detail}` : event.tool
}

export function buildPatternArtifactDocument(options: {
  readonly projectName: string
  readonly projectPath: string
  readonly now: Date
  readonly selectedNodes: readonly CanvasNode[]
  readonly selectedNodeIds: ReadonlySet<string>
  readonly edges: readonly CanvasEdge[]
}): {
  readonly id: string
  readonly filename: string
  readonly markdown: string
  readonly snapshotPath: string
  readonly snapshot: CanvasFile
} {
  const selectedFiles = selectedProjectFileRefs(options.selectedNodes, options.projectPath)
  const noteRefs = selectedNoteRefs(options.selectedNodes, options.projectPath)
  const launchTerminals = selectedLaunchTerminals(options.selectedNodes)
  const titleSeed = selectedFiles[0] ?? options.projectName
  const id = `p-${dateStampForId(options.now)}-${slugifyArtifactPart(titleSeed)}`
  const title = `Pattern: ${selectedFiles[0] ?? options.projectName}`
  const snapshotPath = `${TE_DIR}/artifacts/patterns/${id}.canvas.json`
  const frontmatter: PatternArtifactFrontmatter = {
    id,
    title,
    type: 'pattern',
    created: dateOnly(options.now),
    modified: dateOnly(options.now),
    signal: 'emerging',
    status: 'draft',
    project_root: '.',
    file_refs: selectedFiles,
    note_refs: noteRefs,
    tension_refs: [],
    canvas_snapshot: snapshotPath,
    launch: { terminals: launchTerminals },
    tags: ['pattern', 'workbench'],
    connections: [],
    tensions_with: [],
    summary: `Captured from ${options.selectedNodes.length} selected workbench cards.`
  }

  const sections: SystemArtifactSection[] = [
    {
      heading: 'When To Use',
      body:
        selectedFiles.length > 0
          ? `Use when working in:\n${selectedFiles.map((file) => `- ${file}`).join('\n')}`
          : `Use when revisiting the ${options.projectName} workbench flow.`
    },
    {
      heading: 'Setup',
      body:
        launchTerminals.length > 0
          ? launchTerminals
              .map(
                (terminal) =>
                  `- Terminal in \`${terminal.cwd}\`${terminal.command ? ` running \`${terminal.command}\`` : ''}`
              )
              .join('\n')
          : '- Restore the snapshot and add the terminal steps you need.'
    },
    {
      heading: 'Steps',
      body:
        selectedFiles.length > 0
          ? selectedFiles.map((file) => `- Inspect or edit \`${file}\``).join('\n')
          : '- Reconstruct the flow from the selected cards.'
    },
    {
      heading: 'Failure Modes',
      body: '- Update terminal commands if the workflow no longer matches the project state.'
    },
    {
      heading: 'Exit Criteria',
      body: '- Promote this draft pattern to active after it succeeds more than once.'
    }
  ]

  const snapshot: CanvasFile = {
    nodes: options.selectedNodes.map(cleanNode),
    edges: selectionEdges(options.selectedNodeIds, options.edges),
    viewport: { x: 0, y: 0, zoom: 1 }
  }

  return {
    id,
    filename: id,
    markdown: renderSystemArtifactDocument(frontmatter, sections),
    snapshotPath,
    snapshot
  }
}

export function buildTensionArtifactDocument(options: {
  readonly projectName: string
  readonly projectPath: string
  readonly now: Date
  readonly selectedNodes: readonly CanvasNode[]
  readonly milestones: readonly SessionMilestone[]
}): {
  readonly id: string
  readonly filename: string
  readonly markdown: string
} {
  const latestMilestone = options.milestones.find(
    (milestone) => milestone.type !== 'session-switched'
  )
  const selectedFiles = selectedProjectFileRefs(options.selectedNodes, options.projectPath)
  const milestoneFiles = uniqueStrings(
    (latestMilestone?.files ?? []).map((file) => relativeToProject(file, options.projectPath))
  )
  const fileRefs = selectedFiles.length > 0 ? selectedFiles : milestoneFiles
  const seed = latestMilestone?.summary ?? selectedFiles[0] ?? options.projectName
  const id = `t-${dateStampForId(options.now)}-${slugifyArtifactPart(seed)}`
  const title = latestMilestone
    ? `Investigate: ${latestMilestone.summary}`
    : `Investigate ${options.projectName}`
  const question = latestMilestone
    ? `What remains unresolved about: ${latestMilestone.summary}?`
    : `What is still unresolved in ${options.projectName}?`
  const frontmatter: TensionArtifactFrontmatter = {
    id,
    title,
    type: 'tension',
    created: dateOnly(options.now),
    modified: dateOnly(options.now),
    signal: 'untested',
    status: 'open',
    opened_at: options.now.toISOString(),
    file_refs: fileRefs,
    pattern_refs: [],
    question,
    evidence_refs: [],
    tags: ['tension', 'workbench'],
    connections: [],
    tensions_with: [],
    summary:
      latestMilestone?.summary ??
      `Open question captured from the ${options.projectName} workbench.`
  }

  const evidenceLines = latestMilestone
    ? latestMilestone.events.map((event) => `- ${formatMilestoneEvent(event, options.projectPath)}`)
    : fileRefs.map((file) => `- ${file}`)

  const sections: SystemArtifactSection[] = [
    {
      heading: 'Why This Matters',
      body:
        latestMilestone != null
          ? `This tension was opened while reviewing the milestone:\n- ${latestMilestone.summary}`
          : `This tension was captured directly from the ${options.projectName} workbench.`
    },
    {
      heading: 'Competing Explanations',
      body: '- Add the main hypotheses or tradeoffs here.'
    },
    {
      heading: 'Current Evidence',
      body: evidenceLines.length > 0 ? evidenceLines.join('\n') : '- No evidence captured yet.'
    },
    {
      heading: 'What Would Resolve It',
      body: '- Define the proof, experiment, or implementation change that would close this tension.'
    }
  ]

  return {
    id,
    filename: id,
    markdown: renderSystemArtifactDocument(frontmatter, sections)
  }
}

export function buildSessionArtifactDocument(options: {
  readonly projectName: string
  readonly projectPath: string
  readonly now: Date
  readonly milestones: readonly SessionMilestone[]
  readonly sessionEvents: readonly WorkbenchSessionEvent[]
}): {
  readonly id: string
  readonly filename: string
  readonly markdown: string
} {
  const orderedMilestones = [...options.milestones]
    .filter((milestone) => milestone.type !== 'session-switched')
    .reverse()
  const fileRefs = uniqueStrings(
    options.sessionEvents.flatMap((event) =>
      event.filePath ? [relativeToProject(event.filePath, options.projectPath)] : []
    )
  )
  const sessionIds = uniqueStrings(options.sessionEvents.map((event) => event.sessionId))
  const commandCount = options.sessionEvents.filter((event) => event.type === 'bash-command').length
  const titleSeed = orderedMilestones[orderedMilestones.length - 1]?.summary ?? options.projectName
  const id = `s-${dateStampForId(options.now)}-${slugifyArtifactPart(titleSeed)}`
  const title = `${options.projectName} session ${dateStampForId(options.now)}`
  const startedAt =
    options.sessionEvents[0]?.timestamp ?? orderedMilestones[0]?.timestamp ?? options.now.getTime()
  const latestSummary =
    orderedMilestones[orderedMilestones.length - 1]?.summary ??
    `Ended ${options.projectName} workbench session.`
  const frontmatter: SessionArtifactFrontmatter = {
    id,
    title,
    type: 'session',
    created: dateOnly(options.now),
    modified: dateOnly(options.now),
    signal: 'emerging',
    status: 'completed',
    started_at: isoStringFromTimestamp(startedAt),
    ended_at: options.now.toISOString(),
    project_root: '.',
    claude_session_ids: sessionIds,
    file_refs: fileRefs,
    opened_tensions: [],
    resolved_tensions: [],
    pattern_refs: [],
    command_count: commandCount,
    file_touch_count: fileRefs.length,
    tags: ['session', 'workbench'],
    connections: [],
    tensions_with: [],
    summary: latestSummary
  }

  const sections: SystemArtifactSection[] = [
    {
      heading: 'Context',
      body: [
        `- Project: ${options.projectName}`,
        `- Files touched: ${fileRefs.length}`,
        `- Commands run: ${commandCount}`
      ].join('\n')
    },
    {
      heading: 'What Happened',
      body:
        orderedMilestones.length > 0
          ? orderedMilestones.map((milestone) => `- ${milestone.summary}`).join('\n')
          : '- No live milestones were captured in this session.'
    },
    {
      heading: 'Decisions',
      body: '- Capture the decisions or commits that made this session useful.'
    },
    {
      heading: 'Learnings',
      body:
        fileRefs.length > 0
          ? fileRefs.map((file) => `- Touched \`${file}\``).join('\n')
          : '- No file changes were recorded.'
    },
    {
      heading: 'Next Steps',
      body: '- Reopen the workbench if there are unresolved tensions or promote a stable flow to a pattern.'
    }
  ]

  return {
    id,
    filename: id,
    markdown: renderSystemArtifactDocument(frontmatter, sections)
  }
}
