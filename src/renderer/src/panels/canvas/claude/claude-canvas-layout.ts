import type { ClaudeConfig } from '@shared/claude-config-types'
import type { CanvasNode, CanvasEdge } from '@shared/canvas-types'
import { createCanvasNode } from '@shared/canvas-types'
import { extractRelationships } from '../../../engine/claude-relationship-extractor'

// Compact card sizes (content-fitted, not default oversized)
const CARD_W = 260
const CARD_H_SMALL = 120
const CARD_H_MEDIUM = 160
const CARD_H_LARGE = 200
const SETTINGS_W = 260
const SETTINGS_H = 100
const GAP_X = 20
const GAP_Y = 20
const ZONE_GAP = 60
const COLS_PER_ROW = 5

export interface ZoneLabel {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly color: string
  readonly configType?: string
}

interface LayoutResult {
  readonly nodes: readonly CanvasNode[]
  readonly edges: readonly CanvasEdge[]
  readonly labels: readonly ZoneLabel[]
  readonly terminalOrigin: { readonly x: number; readonly y: number }
}

type LayoutItem = {
  type: CanvasNode['type']
  content: string
  metadata: Record<string, unknown>
  cardW?: number
  cardH?: number
}

/**
 * Lay out items in a grid: left-to-right, top-to-bottom.
 * Returns nodes + the bounding box (maxY) so the next zone knows where to start.
 */
function layoutZoneGrid(
  items: readonly LayoutItem[],
  originX: number,
  originY: number,
  cols: number = COLS_PER_ROW
): { nodes: CanvasNode[]; bottom: number; right: number } {
  const nodes: CanvasNode[] = []
  let maxBottom = originY
  let maxRight = originX

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const col = i % cols
    const row = Math.floor(i / cols)
    const w = item.cardW ?? CARD_W
    const h = item.cardH ?? CARD_H_SMALL
    const x = originX + col * (w + GAP_X)
    const y = originY + row * (h + GAP_Y)

    nodes.push(
      createCanvasNode(
        item.type,
        { x, y },
        { content: item.content, metadata: item.metadata, size: { width: w, height: h } }
      )
    )

    maxBottom = Math.max(maxBottom, y + h)
    maxRight = Math.max(maxRight, x + w)
  }

  return { nodes, bottom: maxBottom, right: maxRight }
}

/**
 * Content-aware flow layout. Each zone is placed below the previous one.
 * No overlap, no fixed offsets from center.
 *
 * Row 1: Rules (horizontal)
 * Row 2: Agents | Skills (authoring workspace)
 * Row 3: Commands | Teams | Settings | Memory (compact strip)
 */
export function layoutClaudeConfig(config: ClaudeConfig): LayoutResult {
  const allNodes: CanvasNode[] = []
  const edges: CanvasEdge[] = []
  const labels: ZoneLabel[] = []
  const LABEL_OFFSET = -28

  let cursorY = 60

  // --- Row 1: Rules (full width, horizontal) ---
  const ruleItems: LayoutItem[] = config.rules.map((r) => ({
    type: 'claude-rule' as const,
    content: r.filePath,
    metadata: { category: r.category, contentPreview: r.content, scope: r.scope },
    cardH: CARD_H_SMALL
  }))

  let ruleBottom = cursorY
  if (ruleItems.length > 0) {
    labels.push({
      text: `Rules (${ruleItems.length})`,
      x: 0,
      y: cursorY + LABEL_OFFSET,
      color: '#94a3b8',
      configType: 'rule'
    })
    const rules = layoutZoneGrid(ruleItems, 0, cursorY, COLS_PER_ROW)
    allNodes.push(...rules.nodes)
    ruleBottom = rules.bottom
    cursorY = ruleBottom + ZONE_GAP
  }

  // --- Row 2: Agents | Skills (authoring workspace) ---
  const row2Y = cursorY

  // Agents (left column)
  const agentItems: LayoutItem[] = config.agents.map((a) => ({
    type: 'claude-agent' as const,
    content: a.filePath,
    metadata: {
      agentName: a.name,
      model: a.model,
      tools: [...a.tools],
      description: a.description,
      instructionPreview: a.instructionPreview
    },
    cardW: CARD_W + 20,
    cardH: CARD_H_LARGE
  }))

  const agentCols = 2
  const agents = layoutZoneGrid(agentItems, 0, row2Y, agentCols)
  allNodes.push(...agents.nodes)

  if (agentItems.length > 0) {
    labels.push({
      text: `Agents (${agentItems.length})`,
      x: 0,
      y: row2Y + LABEL_OFFSET,
      color: '#a78bfa',
      configType: 'agent'
    })
  }

  // Skills (right column, after agents)
  const skillX = agents.right + ZONE_GAP
  const skillItems: LayoutItem[] = config.skills.map((s) => ({
    type: 'claude-skill' as const,
    content: s.filePath,
    metadata: {
      skillName: s.name,
      description: s.description,
      refCount: s.referenceFiles.length,
      promptCount: s.promptFiles.length
    },
    cardH: CARD_H_MEDIUM
  }))

  if (skillItems.length > 0) {
    labels.push({
      text: `Skills (${skillItems.length})`,
      x: skillX,
      y: row2Y + LABEL_OFFSET,
      color: '#22d3ee',
      configType: 'skill'
    })
  }
  const skillCols = 4
  const skills = layoutZoneGrid(skillItems, skillX, row2Y, skillCols)
  allNodes.push(...skills.nodes)

  const row2Bottom = Math.max(agents.bottom, skills.bottom)
  cursorY = row2Bottom + ZONE_GAP

  // --- Row 3: Commands | Teams | Settings | Memory (compact strip) ---
  const row3Y = cursorY

  // Commands (left)
  const cmdItems: LayoutItem[] = config.commands.map((c) => ({
    type: 'claude-command' as const,
    content: c.filePath,
    metadata: {
      commandName: c.name,
      description: c.description,
      contentPreview: c.content,
      scope: c.scope
    },
    cardH: CARD_H_MEDIUM
  }))

  if (cmdItems.length > 0) {
    labels.push({
      text: `Commands (${cmdItems.length})`,
      x: 0,
      y: row3Y + LABEL_OFFSET,
      color: '#34d399',
      configType: 'command'
    })
  }
  const cmdCols = 4
  const cmds = layoutZoneGrid(cmdItems, 0, row3Y, cmdCols)
  allNodes.push(...cmds.nodes)

  // Teams (middle, after commands)
  const teamX = cmds.right + ZONE_GAP
  const teamItems: LayoutItem[] = config.teams.map((t) => ({
    type: 'claude-team' as const,
    content: t.filePath,
    metadata: {
      memberCount: t.members.length,
      leadAgentId: t.lead,
      teamName: t.name,
      members: [...t.members]
    },
    cardW: CARD_W + 40,
    cardH: CARD_H_LARGE
  }))

  if (teamItems.length > 0) {
    labels.push({
      text: `Teams (${teamItems.length})`,
      x: teamX,
      y: row3Y + LABEL_OFFSET,
      color: '#f472b6'
    })
  }
  const teamCols = 2
  const teams = layoutZoneGrid(teamItems, teamX, row3Y, teamCols)
  allNodes.push(...teams.nodes)

  // Settings (compact, after teams)
  const settingsX = teams.right + ZONE_GAP
  let settingsRight = settingsX

  if (config.settings) {
    labels.push({ text: 'Settings', x: settingsX, y: row3Y + LABEL_OFFSET, color: '#f59e0b' })
    const settingsNode = createCanvasNode(
      'claude-settings',
      { x: settingsX, y: row3Y },
      {
        content: config.basePath + '/settings.json',
        metadata: {
          permissionCount: config.settings.allowCount,
          envVarCount: config.settings.envVars.length,
          pluginNames: config.settings.plugins
        },
        size: { width: SETTINGS_W, height: SETTINGS_H }
      }
    )
    allNodes.push(settingsNode)
    settingsRight = settingsX + SETTINGS_W
  }

  // Memory (right, after settings)
  const memX = settingsRight + ZONE_GAP
  const memItems: LayoutItem[] = config.memories.map((m) => ({
    type: 'claude-memory' as const,
    content: m.filePath,
    metadata: {
      memoryType: m.memoryType,
      linkCount: m.links.length,
      memoryName: m.name,
      description: m.description,
      contentPreview: m.content,
      scope: m.scope
    },
    cardH: CARD_H_SMALL
  }))

  if (memItems.length > 0) {
    labels.push({
      text: `Memory (${memItems.length})`,
      x: memX,
      y: row3Y + LABEL_OFFSET,
      color: '#fb923c',
      configType: config.projectPath ? 'memory' : undefined
    })
  }
  const memCols = 3
  const mems = layoutZoneGrid(memItems, memX, row3Y, memCols)
  allNodes.push(...mems.nodes)

  // --- Extract all relationships via the relationship extractor ---
  const extractedEdges = extractRelationships(config, allNodes)
  edges.push(...extractedEdges)

  // Terminal origin: right of skills column, below row 3 with standard gap
  const row3Bottom = Math.max(cmds.bottom, teams.bottom, mems.bottom)
  const terminalOrigin = { x: skillX, y: row3Bottom + ZONE_GAP }

  return { nodes: allNodes, edges, labels, terminalOrigin }
}
