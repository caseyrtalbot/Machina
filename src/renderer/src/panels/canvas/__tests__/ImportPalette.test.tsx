import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImportPalette } from '../ImportPalette'
import { useEditorStore } from '../../../store/editor-store'
import { useVaultStore } from '../../../store/vault-store'
import { DEFAULT_CANVAS_ID, getCanvasStore } from '../../../store/canvas-store'
import { CanvasStoreProvider } from '../canvas-store-context'

describe('ImportPalette active note identity', () => {
  beforeEach(() => {
    useEditorStore.setState({
      activeNotePath: '/vault/notes/hello.md',
      mode: 'rich',
      isDirty: false,
      content: '',
      openTabs: [],
      historyStack: [],
      historyIndex: -1
    })

    useVaultStore.setState({
      graph: {
        nodes: [{ id: 'hello', title: 'Hello', type: 'note', signal: 'core', connectionCount: 0 }],
        edges: []
      },
      artifacts: [
        {
          id: 'hello',
          title: 'Hello',
          type: 'note',
          created: '2026-03-30',
          modified: '2026-03-30',
          signal: 'core',
          tags: ['greeting'],
          connections: [],
          clusters_with: [],
          tensions_with: [],
          appears_in: [],
          related: [],
          origin: 'human',
          sources: [],
          concepts: [],
          bodyLinks: [],
          body: 'Hello body',
          frontmatter: {}
        }
      ],
      fileToId: {
        '/vault/notes/hello.md': 'hello'
      }
    })

    getCanvasStore(DEFAULT_CANVAS_ID).setState({ nodes: [], edges: [] })
  })

  afterEach(() => {
    cleanup()
  })

  it('derives the active artifact from activeNotePath', () => {
    render(
      <CanvasStoreProvider canvasId={DEFAULT_CANVAS_ID}>
        <ImportPalette
          open={true}
          onClose={vi.fn()}
          onImport={vi.fn()}
          containerWidth={1200}
          containerHeight={800}
        />
      </CanvasStoreProvider>
    )

    expect(screen.getByText('Neighborhood of')).toBeTruthy()
    expect(screen.getByText('Hello')).toBeTruthy()
  })
})
