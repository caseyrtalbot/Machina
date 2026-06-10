import { describe, it, expect } from 'vitest'
import { filterSidebarFiles } from '../sidebar-filtering'
import type { Artifact } from '@shared/types'

function makeArtifact(id: string, tags: string[]): Artifact {
  return {
    id,
    title: id,
    type: 'note',
    signal: 'untested',
    tags,
    connections: [],
    clusters_with: [],
    tensions_with: [],
    appears_in: [],
    related: [],
    concepts: [],
    origin: 'human',
    sources: [],
    bodyLinks: [],
    body: '',
    frontmatter: {}
  }
}

const VAULT = '/vault'

const files = [
  { path: '/vault/projects/alpha.md' },
  { path: '/vault/projects/beta.md' },
  { path: '/vault/journal/today.md' },
  { path: '/vault/loose.md' },
  { path: '/vault/projects/image.png' }
]

const artifacts = [
  makeArtifact('alpha', ['work', 'work/deep']),
  makeArtifact('beta', ['work']),
  makeArtifact('today', ['journal']),
  makeArtifact('loose', [])
]

const fileToId: Record<string, string> = {
  '/vault/projects/alpha.md': 'alpha',
  '/vault/projects/beta.md': 'beta',
  '/vault/journal/today.md': 'today',
  '/vault/loose.md': 'loose'
}

function filter(opts: {
  activeWorkspace?: string | null
  selectedTags?: readonly string[]
  tagOperator?: 'and' | 'or'
}) {
  return filterSidebarFiles(files, {
    vaultPath: VAULT,
    activeWorkspace: opts.activeWorkspace ?? null,
    selectedTags: opts.selectedTags ?? [],
    tagOperator: opts.tagOperator ?? 'or',
    artifacts,
    fileToId
  }).map((f) => f.path)
}

describe('filterSidebarFiles', () => {
  it('returns all files when no filters are active', () => {
    expect(filter({})).toEqual(files.map((f) => f.path))
  })

  it('filters by workspace folder prefix', () => {
    expect(filter({ activeWorkspace: 'projects' })).toEqual([
      '/vault/projects/alpha.md',
      '/vault/projects/beta.md',
      '/vault/projects/image.png'
    ])
  })

  it('does not prefix-match sibling folders sharing a name prefix', () => {
    // 'project' must not match 'projects/'
    expect(filter({ activeWorkspace: 'project' })).toEqual([])
  })

  it('filters by a selected tag (OR)', () => {
    expect(filter({ selectedTags: ['journal'] })).toEqual(['/vault/journal/today.md'])
  })

  it('OR matches any selected tag', () => {
    expect(filter({ selectedTags: ['journal', 'work'], tagOperator: 'or' })).toEqual([
      '/vault/projects/alpha.md',
      '/vault/projects/beta.md',
      '/vault/journal/today.md'
    ])
  })

  it('AND requires every selected tag', () => {
    expect(filter({ selectedTags: ['work', 'work/deep'], tagOperator: 'and' })).toEqual([
      '/vault/projects/alpha.md'
    ])
  })

  it('nested tags match by parent prefix', () => {
    // selecting 'work' matches 'work/deep' too
    expect(filter({ selectedTags: ['work'] })).toContain('/vault/projects/alpha.md')
  })

  it('excludes files without artifacts while a tag filter is active', () => {
    const result = filter({ selectedTags: ['work'] })
    expect(result).not.toContain('/vault/projects/image.png')
  })

  it('combines workspace and tag filters (intersection)', () => {
    expect(filter({ activeWorkspace: 'projects', selectedTags: ['work/deep'] })).toEqual([
      '/vault/projects/alpha.md'
    ])
  })

  it('skips the workspace filter when vaultPath is null', () => {
    const result = filterSidebarFiles(files, {
      vaultPath: null,
      activeWorkspace: 'projects',
      selectedTags: [],
      tagOperator: 'or',
      artifacts,
      fileToId
    })
    expect(result).toHaveLength(files.length)
  })
})
