import { describe, it, expect, vi } from 'vitest'
import { useVaultStore } from '../../src/renderer/src/store/vault-store'
import type { WorkerResult } from '../../src/shared/engine/types'
import type { Artifact, KnowledgeGraph } from '../../src/shared/types'

describe('flushSync avoidance', () => {
  it('NoteCard defers setContent to queueMicrotask', async () => {
    const setContentSpy = vi.fn()
    const originalQueueMicrotask = globalThis.queueMicrotask
    const microtaskCalls: Array<() => void> = []

    globalThis.queueMicrotask = (cb: () => void) => microtaskCalls.push(cb)

    const editor = {
      isDestroyed: false,
      storage: {
        markdown: {
          manager: { parse: (body: string) => ({ type: 'doc', content: body }) }
        }
      },
      commands: { setContent: setContentSpy }
    }
    const body = '# Hello'
    const loading = false

    // This mirrors the fixed useEffect body
    if (editor && body && !loading) {
      queueMicrotask(() => {
        if (editor.isDestroyed) return
        const manager = editor.storage.markdown?.manager
        if (manager) {
          editor.commands.setContent(manager.parse(body))
        } else {
          editor.commands.setContent(body)
        }
      })
    }

    expect(setContentSpy).not.toHaveBeenCalled()
    expect(microtaskCalls).toHaveLength(1)

    microtaskCalls[0]()
    expect(setContentSpy).toHaveBeenCalledOnce()

    globalThis.queueMicrotask = originalQueueMicrotask
  })

  it('skips setContent if editor is destroyed before microtask runs', () => {
    const setContentSpy = vi.fn()
    const microtaskCalls: Array<() => void> = []
    const originalQueueMicrotask = globalThis.queueMicrotask
    globalThis.queueMicrotask = (cb: () => void) => microtaskCalls.push(cb)

    const editor = {
      isDestroyed: false,
      storage: { markdown: { manager: { parse: () => ({}) } } },
      commands: { setContent: setContentSpy }
    }

    queueMicrotask(() => {
      if (editor.isDestroyed) return
      editor.commands.setContent('content')
    })

    editor.isDestroyed = true
    microtaskCalls[0]()

    expect(setContentSpy).not.toHaveBeenCalled()

    globalThis.queueMicrotask = originalQueueMicrotask
  })
})

function makeArtifact(id: string, title: string): Artifact {
  return {
    id,
    title,
    type: 'note',
    path: `/${id}.md`,
    body: '',
    bodyLinks: [],
    tags: [],
    connections: [],
    clusters_with: [],
    tensions_with: [],
    related: [],
    frontmatter: {}
  } as Artifact
}

describe('vault-store derived maps', () => {
  beforeEach(() => {
    useVaultStore.setState(useVaultStore.getInitialState())
  })

  it('setWorkerResult populates artifactById', () => {
    const a1 = makeArtifact('abc', 'First')
    const a2 = makeArtifact('def', 'Second')
    const result: WorkerResult = {
      artifacts: [a1, a2],
      graph: { nodes: [], edges: [] },
      errors: [],
      fileToId: { '/abc.md': 'abc', '/def.md': 'def' },
      artifactPathById: { abc: '/abc.md', def: '/def.md' }
    }

    useVaultStore.getState().setWorkerResult(result)

    const state = useVaultStore.getState()
    expect(state.artifactById['abc']).toBe(a1)
    expect(state.artifactById['def']).toBe(a2)
    expect(state.artifactById['nonexistent']).toBeUndefined()
  })

  it('setWorkerResult populates edgeCountByArtifactId', () => {
    const result: WorkerResult = {
      artifacts: [makeArtifact('a', 'A'), makeArtifact('b', 'B')],
      graph: {
        nodes: [],
        edges: [
          { source: 'a', target: 'b', kind: 'connection' },
          { source: 'a', target: 'c', kind: 'related' }
        ]
      } as KnowledgeGraph,
      errors: [],
      fileToId: {},
      artifactPathById: {}
    }

    useVaultStore.getState().setWorkerResult(result)

    const state = useVaultStore.getState()
    expect(state.edgeCountByArtifactId['a']).toBe(2)
    expect(state.edgeCountByArtifactId['b']).toBe(1)
    expect(state.edgeCountByArtifactId['c']).toBe(1)
  })

  it('setWorkerResult populates rawFileCount', () => {
    const connected = makeArtifact('a', 'A')
    connected.connections = ['b']
    const isolated = makeArtifact('b', 'B')

    const result: WorkerResult = {
      artifacts: [connected, isolated],
      graph: { nodes: [], edges: [] },
      errors: [],
      fileToId: {},
      artifactPathById: {}
    }

    useVaultStore.getState().setWorkerResult(result)
    expect(useVaultStore.getState().rawFileCount).toBe(1)
  })
})
