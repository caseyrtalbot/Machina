import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Statusbar } from '../../src/renderer/src/components/Statusbar'
import {
  setIndexingProgress,
  clearIndexingProgress
} from '../../src/renderer/src/utils/chunk-loader'

describe('Statusbar indexing indicator', () => {
  beforeEach(() => {
    cleanup()
    clearIndexingProgress()
  })

  it('shows "Indexing N/M notes" while chunk loading is in progress', () => {
    setIndexingProgress(50, 5000)
    render(<Statusbar />)
    expect(screen.getByText('Indexing 50/5k notes')).toBeDefined()
  })

  it('shows no indexing item when idle', () => {
    render(<Statusbar />)
    expect(screen.queryByText(/^Indexing /)).toBeNull()
    expect(screen.getByText('No vault loaded')).toBeDefined()
  })

  it('does not render the fake encoding item', () => {
    render(<Statusbar />)
    expect(screen.queryByText('UTF-8 · LF')).toBeNull()
  })
})
