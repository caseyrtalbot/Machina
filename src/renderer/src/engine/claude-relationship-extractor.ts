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
  kind: ClaudeRelationshipKind,
  hidden?: boolean
): ClaudeEdge {
  return {
    ...createCanvasEdge(fromNode, toNode, fromSide, toSide),
    kind,
    ...(hidden ? { hidden } : {})
  }
}

/**
 * Returns true if text contains an explicit reference to name.
 * Requires a slash-prefixed invocation (/name) or a whole-word match that is
 * not a simple substring of a longer word (word-boundary via regex).
 * Names of 4 characters or fewer are skipped to avoid noise.
 * The slash-prefix check is always authoritative; the word-boundary fallback
 * only applies when the name itself contains a hyphen (compound skill names).
 */
function mentionsName(text: string, name: string): boolean {
  if (name.length <= 4) return false
  const lower = text.toLowerCase()
  const target = name.toLowerCase()
  if (lower.includes(`/${target}`)) return true
  // Only use word-boundary matching for hyphenated names (e.g. "research-team")
  // to avoid false positives from common words used as prose.
  if (!target.includes('-')) return false
  const regex = new RegExp(`\\b${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  return regex.test(text)
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
        createClaudeEdge(settingsNode.id, agentNode.id, 'left', 'right', 'settings-controls', true)
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
      if (mentionsName(searchText, skillName)) {
        edges.push(createClaudeEdge(agentNode.id, skillNode.id, 'right', 'left', 'agent-uses-tool'))
      }
    }

    for (const cmdNode of commandNodes) {
      const cmdName = ((cmdNode.metadata as Record<string, unknown>).commandName as string) ?? ''
      if (mentionsName(searchText, cmdName)) {
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

    for (let j = 0; j < config.skills.length; j++) {
      if (i === j) continue
      const other = config.skills[j]
      const otherNode = skillNodes[j]
      if (!otherNode) continue

      if (mentionsName(skill.description, other.name)) {
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
