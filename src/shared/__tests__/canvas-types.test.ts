import { describe, expect, it } from 'vitest'
import {
  CARD_TYPE_INFO,
  getDefaultMetadata,
  getDefaultSize,
  getMinSize,
  type CanvasNodeType
} from '../canvas-types'

const ALL_TYPES: CanvasNodeType[] = [
  'text',
  'note',
  'terminal',
  'code',
  'markdown',
  'image',
  'pdf',
  'project-file',
  'system-artifact',
  'file-view',
  'agent-session',
  'project-folder',
  'terminal-block'
]

describe('canvas-types registration completeness', () => {
  it.each(ALL_TYPES)('"%s" has a min size', (type) => {
    const size = getMinSize(type)
    expect(size.width).toBeGreaterThan(0)
    expect(size.height).toBeGreaterThan(0)
  })

  it.each(ALL_TYPES)('"%s" has a default size', (type) => {
    const size = getDefaultSize(type)
    expect(size.width).toBeGreaterThan(0)
    expect(size.height).toBeGreaterThan(0)
  })

  it.each(ALL_TYPES)('"%s" has card type info', (type) => {
    const info = CARD_TYPE_INFO[type]
    expect(info.label).toBeTruthy()
    expect(info.icon).toBeTruthy()
    expect(info.category).toBeTruthy()
  })

  it.each(ALL_TYPES)('"%s" returns default metadata', (type) => {
    const meta = getDefaultMetadata(type)
    expect(typeof meta).toBe('object')
  })

  it('system-artifact default metadata has expected shape', () => {
    const meta = getDefaultMetadata('system-artifact')
    expect(meta).toMatchObject({
      artifactKind: 'session',
      artifactId: '',
      status: '',
      filePath: '',
      signal: 'untested',
      fileRefCount: 0,
      connections: [],
      tensionRefs: []
    })
  })

  it('agent-session default metadata has expected shape', () => {
    const meta = getDefaultMetadata('agent-session')
    expect(meta).toMatchObject({
      sessionId: '',
      status: 'idle',
      filesTouched: [],
      startedAt: 0,
      lastActivity: 0
    })
  })

  it('project-folder default metadata has expected shape', () => {
    const meta = getDefaultMetadata('project-folder')
    expect(meta).toMatchObject({
      relativePath: '',
      rootPath: '',
      childCount: 0,
      collapsed: false
    })
  })

  it('project-folder has correct card type info', () => {
    const info = CARD_TYPE_INFO['project-folder']
    expect(info.label).toBe('Folder')
    expect(info.icon).toBe('\u{1F4C1}')
    expect(info.category).toBe('tools')
  })

  it('project-folder min size is 200x60', () => {
    const size = getMinSize('project-folder')
    expect(size).toEqual({ width: 200, height: 60 })
  })

  it('project-folder default size is 260x80', () => {
    const size = getDefaultSize('project-folder')
    expect(size).toEqual({ width: 260, height: 80 })
  })

  it('terminal-block default metadata has expected shape', () => {
    const meta = getDefaultMetadata('terminal-block')
    expect(meta).toMatchObject({
      sessionId: '',
      blockId: '',
      command: '',
      exitCode: null,
      startedAtMs: null,
      finishedAtMs: null,
      cwd: null,
      agentContext: null
    })
  })

  it('terminal-block has correct card type info', () => {
    const info = CARD_TYPE_INFO['terminal-block']
    expect(info.label).toBe('Block')
    expect(info.category).toBe('tools')
  })
})
