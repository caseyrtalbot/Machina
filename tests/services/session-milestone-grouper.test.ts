import { describe, it, expect } from 'vitest'
import { groupEventsIntoMilestones } from '../../src/main/services/session-milestone-grouper'
import type { SessionToolEvent } from '@shared/project-canvas-types'

const ts = 1710849600000 // fixed timestamp for tests

describe('groupEventsIntoMilestones', () => {
  it('returns empty array for empty input', () => {
    expect(groupEventsIntoMilestones([])).toEqual([])
  })

  it('groups consecutive Reads into one research milestone', () => {
    const events: SessionToolEvent[] = [
      { tool: 'Read', timestamp: ts, filePath: '/a.ts' },
      { tool: 'Read', timestamp: ts + 1000, filePath: '/b.ts' },
      { tool: 'Read', timestamp: ts + 2000, filePath: '/c.ts' }
    ]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(1)
    expect(milestones[0].type).toBe('research')
    expect(milestones[0].summary).toContain('3')
    expect(milestones[0].files).toHaveLength(3)
    expect(milestones[0].events).toHaveLength(3)
  })

  it('creates edit milestone for a single Edit', () => {
    const events: SessionToolEvent[] = [
      { tool: 'Edit', timestamp: ts, filePath: '/parser.ts', detail: 'added parseCoEditPairs' }
    ]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(1)
    expect(milestones[0].type).toBe('edit')
    expect(milestones[0].files).toEqual(['/parser.ts'])
  })

  it('groups consecutive Edits on same file into one milestone', () => {
    const events: SessionToolEvent[] = [
      { tool: 'Edit', timestamp: ts, filePath: '/parser.ts', detail: 'change 1' },
      { tool: 'Edit', timestamp: ts + 1000, filePath: '/parser.ts', detail: 'change 2' },
      { tool: 'Edit', timestamp: ts + 2000, filePath: '/parser.ts', detail: 'change 3' }
    ]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(1)
    expect(milestones[0].type).toBe('edit')
    expect(milestones[0].summary).toContain('3')
    expect(milestones[0].events).toHaveLength(3)
  })

  it('creates separate milestones for Edits across different files', () => {
    const events: SessionToolEvent[] = [
      { tool: 'Edit', timestamp: ts, filePath: '/a.ts' },
      { tool: 'Edit', timestamp: ts + 1000, filePath: '/b.ts' }
    ]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(2)
    expect(milestones[0].files).toEqual(['/a.ts'])
    expect(milestones[1].files).toEqual(['/b.ts'])
  })

  it('creates command milestone for Bash', () => {
    const events: SessionToolEvent[] = [{ tool: 'Bash', timestamp: ts, detail: 'npm test' }]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(1)
    expect(milestones[0].type).toBe('command')
    expect(milestones[0].summary).toContain('npm test')
  })

  it('creates create milestone for Write', () => {
    const events: SessionToolEvent[] = [{ tool: 'Write', timestamp: ts, filePath: '/new-file.ts' }]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(1)
    expect(milestones[0].type).toBe('create')
    expect(milestones[0].files).toEqual(['/new-file.ts'])
  })

  it('breaks groups when category changes', () => {
    const events: SessionToolEvent[] = [
      { tool: 'Read', timestamp: ts, filePath: '/a.ts' },
      { tool: 'Read', timestamp: ts + 1000, filePath: '/b.ts' },
      { tool: 'Edit', timestamp: ts + 2000, filePath: '/a.ts' },
      { tool: 'Read', timestamp: ts + 3000, filePath: '/c.ts' }
    ]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(3)
    expect(milestones[0].type).toBe('research')
    expect(milestones[1].type).toBe('edit')
    expect(milestones[2].type).toBe('research')
  })

  it('handles single event as single milestone', () => {
    const events: SessionToolEvent[] = [{ tool: 'Grep', timestamp: ts, filePath: '/src' }]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(1)
    expect(milestones[0].type).toBe('research')
  })

  it('groups consecutive Grep with Read into one research milestone', () => {
    const events: SessionToolEvent[] = [
      { tool: 'Grep', timestamp: ts, filePath: '/src' },
      { tool: 'Read', timestamp: ts + 1000, filePath: '/a.ts' }
    ]
    const milestones = groupEventsIntoMilestones(events)
    expect(milestones).toHaveLength(1)
    expect(milestones[0].type).toBe('research')
  })
})
