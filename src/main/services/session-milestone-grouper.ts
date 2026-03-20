import { randomUUID } from 'crypto'
import type { SessionMilestone, SessionToolEvent } from '@shared/project-canvas-types'

// Note: 'error' type milestones (non-zero exit codes) are deferred.
// They require parsing tool_result entries which is not yet implemented.

type MilestoneCategory = 'research' | 'edit' | 'create' | 'command'

function getCategory(tool: SessionToolEvent['tool']): MilestoneCategory {
  switch (tool) {
    case 'Read':
    case 'Grep':
      return 'research'
    case 'Edit':
      return 'edit'
    case 'Write':
      return 'create'
    case 'Bash':
      return 'command'
  }
}

function baseName(filePath: string | undefined): string {
  if (!filePath) return 'unknown'
  return filePath.split('/').pop() ?? filePath
}

function buildMilestone(
  category: MilestoneCategory,
  events: readonly SessionToolEvent[]
): SessionMilestone {
  const first = events[0]
  const timestamp = first.timestamp
  const files = events.flatMap((e) => (e.filePath ? [e.filePath] : []))
  const count = events.length

  let summary: string

  switch (category) {
    case 'research':
      summary =
        count === 1
          ? `Researching: ${baseName(first.filePath)}`
          : `Researching: ${count} operations`
      break

    case 'edit': {
      const filename = baseName(first.filePath)
      summary = count === 1 ? `Edited ${filename}` : `Edited ${filename}: ${count} edits`
      break
    }

    case 'create':
      summary = `Created ${baseName(first.filePath)}`
      break

    case 'command': {
      const raw = first.detail ?? ''
      const preview = raw.length > 100 ? raw.slice(0, 100) : raw
      summary = preview || 'Command'
      break
    }
  }

  return {
    id: randomUUID(),
    type: category,
    timestamp,
    summary,
    files,
    events
  }
}

function shouldBreakGroup(
  category: MilestoneCategory,
  current: SessionToolEvent,
  group: SessionToolEvent[]
): boolean {
  // Bash and Write always get their own milestone
  if (category === 'command' || category === 'create') return true

  // Edit: break if the file path changes
  if (category === 'edit') {
    const groupFile = group[0].filePath
    return current.filePath !== groupFile
  }

  // Research: consecutive Read/Grep always group together
  return false
}

export function groupEventsIntoMilestones(events: readonly SessionToolEvent[]): SessionMilestone[] {
  if (events.length === 0) return []

  const milestones: SessionMilestone[] = []
  let currentGroup: SessionToolEvent[] = []
  let currentCategory: MilestoneCategory = getCategory(events[0].tool)

  for (const event of events) {
    const category = getCategory(event.tool)

    // Bash and Write always get their own milestone: flush current group, emit single-event milestone
    if (category === 'command' || category === 'create') {
      if (currentGroup.length > 0) {
        milestones.push(buildMilestone(currentCategory, currentGroup))
        currentGroup = []
      }
      milestones.push(buildMilestone(category, [event]))
      currentCategory = category
      continue
    }

    // For groupable categories, check whether to flush and start a new group
    const categoryChanged = category !== currentCategory
    const breakWithinCategory =
      !categoryChanged && currentGroup.length > 0 && shouldBreakGroup(category, event, currentGroup)

    if (categoryChanged || breakWithinCategory) {
      if (currentGroup.length > 0) {
        milestones.push(buildMilestone(currentCategory, currentGroup))
      }
      currentGroup = []
      currentCategory = category
    }

    currentGroup.push(event)
  }

  if (currentGroup.length > 0) {
    milestones.push(buildMilestone(currentCategory, currentGroup))
  }

  return milestones
}
