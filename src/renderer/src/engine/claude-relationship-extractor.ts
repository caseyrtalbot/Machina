import type { ClaudeConfig } from '@shared/claude-config-types'
import type { CanvasNode, CanvasEdge } from '@shared/canvas-types'
import { createCanvasEdge } from '@shared/canvas-types'

export type ClaudeRelationshipKind =
  | 'agent-uses-tool'
  | 'team-has-member'
  | 'skill-references'
  | 'memory-links'
  | 'command-invokes'
  | 'settings-controls'

export interface ClaudeEdge extends CanvasEdge {
  readonly kind: ClaudeRelationshipKind
}

function createClaudeEdge(
  fromNode: string,
  toNode: string,
  fromSide: CanvasEdge['fromSide'],
  toSide: CanvasEdge['toSide'],
  kind: ClaudeRelationshipKind
): ClaudeEdge {
  return { ...createCanvasEdge(fromNode, toNode, fromSide, toSide), kind }
}

/**
 * Build a lookup map from component name (lowercase) to node ID.
 */
function buildNameIndex(nodes: readonly CanvasNode[]): Map<string, string> {
  const index = new Map<string, string>()

  for (const node of nodes) {
    const meta = node.metadata as Record<string, unknown>
    const name =
      (meta.agentName as string) ??
      (meta.skillName as string) ??
      (meta.commandName as string) ??
      (meta.teamName as string) ??
      (meta.memoryName as string) ??
      ''

    if (name) {
      index.set(name.toLowerCase(), node.id)
    }
  }

  return index
}

/**
 * Extract relationships between Claude config components.
 * Scans content and metadata for references to other components.
 */
export function extractRelationships(
  config: ClaudeConfig,
  nodes: readonly CanvasNode[]
): readonly ClaudeEdge[] {
  const edges: ClaudeEdge[] = []
  const nameIndex = buildNameIndex(nodes)

  const settingsNode = nodes.find((n) => n.type === 'claude-settings')
  const agentNodes = nodes.filter((n) => n.type === 'claude-agent')
  const skillNodes = nodes.filter((n) => n.type === 'claude-skill')
  const commandNodes = nodes.filter((n) => n.type === 'claude-command')
  const teamNodes = nodes.filter((n) => n.type === 'claude-team')

  // --- Settings → Agents (settings-controls) ---
  if (settingsNode) {
    for (const agentNode of agentNodes) {
      edges.push(
        createClaudeEdge(settingsNode.id, agentNode.id, 'left', 'right', 'settings-controls')
      )
    }
  }

  // --- Teams → Agents (team-has-member) ---
  for (let i = 0; i < config.teams.length; i++) {
    const team = config.teams[i]
    const teamNode = teamNodes[i]
    if (!teamNode) continue

    for (const memberName of team.members) {
      const agentId = nameIndex.get(memberName.toLowerCase())
      if (agentId) {
        edges.push(createClaudeEdge(teamNode.id, agentId, 'top', 'bottom', 'team-has-member'))
      }
    }
  }

  // --- Commands → Skills/Agents (command-invokes) ---
  // Scan command content for references to skill or agent names
  for (let i = 0; i < config.commands.length; i++) {
    const cmd = config.commands[i]
    const cmdNode = commandNodes[i]
    if (!cmdNode) continue

    const body = cmd.content.toLowerCase()

    // Check if command body references any skill
    for (let j = 0; j < config.skills.length; j++) {
      const skill = config.skills[j]
      const skillNode = skillNodes[j]
      if (!skillNode) continue

      if (body.includes(skill.name.toLowerCase())) {
        edges.push(createClaudeEdge(cmdNode.id, skillNode.id, 'right', 'left', 'command-invokes'))
      }
    }

    // Check if command body references any agent
    for (const agentNode of agentNodes) {
      const agentName = ((agentNode.metadata as Record<string, unknown>).agentName as string) ?? ''
      if (agentName && body.includes(agentName.toLowerCase())) {
        edges.push(createClaudeEdge(cmdNode.id, agentNode.id, 'top', 'bottom', 'command-invokes'))
      }
    }
  }

  // --- Agents → Skills/Commands (agent-uses-tool) ---
  // Scan agent instruction previews for references to skill or command names
  for (const agentNode of agentNodes) {
    const meta = agentNode.metadata as Record<string, unknown>
    const preview = ((meta.instructionPreview as string) ?? '').toLowerCase()
    const agentDesc = ((meta.agentDescription as string) ?? '').toLowerCase()
    const searchText = preview + ' ' + agentDesc

    if (!searchText.trim()) continue

    for (const skillNode of skillNodes) {
      const skillName = ((skillNode.metadata as Record<string, unknown>).skillName as string) ?? ''
      if (skillName.length > 3 && searchText.includes(skillName.toLowerCase())) {
        edges.push(createClaudeEdge(agentNode.id, skillNode.id, 'right', 'left', 'agent-uses-tool'))
      }
    }

    for (const cmdNode of commandNodes) {
      const cmdName = ((cmdNode.metadata as Record<string, unknown>).commandName as string) ?? ''
      if (cmdName.length > 3 && searchText.includes(cmdName.toLowerCase())) {
        edges.push(createClaudeEdge(agentNode.id, cmdNode.id, 'right', 'left', 'agent-uses-tool'))
      }
    }
  }

  // --- Skills → Skills (skill-references) ---
  // Scan skill descriptions for references to other skill names
  for (let i = 0; i < config.skills.length; i++) {
    const skill = config.skills[i]
    const skillNode = skillNodes[i]
    if (!skillNode) continue

    const desc = skill.description.toLowerCase()
    for (let j = 0; j < config.skills.length; j++) {
      if (i === j) continue
      const other = config.skills[j]
      const otherNode = skillNodes[j]
      if (!otherNode) continue

      if (desc.includes(other.name.toLowerCase()) && other.name.length > 3) {
        edges.push(
          createClaudeEdge(skillNode.id, otherNode.id, 'right', 'left', 'skill-references')
        )
      }
    }
  }

  // --- Memory links (memory → referenced files) ---
  for (let i = 0; i < config.memories.length; i++) {
    const mem = config.memories[i]
    const memNode = nodes.filter((n) => n.type === 'claude-memory')[i]
    if (!memNode) continue

    for (const link of mem.links) {
      const linkName = link.replace('.md', '').toLowerCase()
      const targetId = nameIndex.get(linkName)
      if (targetId && targetId !== memNode.id) {
        edges.push(createClaudeEdge(memNode.id, targetId, 'left', 'right', 'memory-links'))
      }
    }
  }

  return edges
}

/** Edge colors by relationship kind */
export const EDGE_KIND_COLORS: Record<ClaudeRelationshipKind, string> = {
  'settings-controls': '#f59e0b',
  'team-has-member': '#f472b6',
  'command-invokes': '#34d399',
  'skill-references': '#22d3ee',
  'memory-links': '#fb923c',
  'agent-uses-tool': '#a78bfa'
}
