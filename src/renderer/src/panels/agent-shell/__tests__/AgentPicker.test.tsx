import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentPicker } from '../AgentPicker'

describe('AgentPicker', () => {
  it('lists all five identities including the raw fallback (workstation step 1)', () => {
    render(<AgentPicker onPick={vi.fn()} onCancel={vi.fn()} />)
    for (const tag of ['native', 'claude', 'codex', 'gemini', 'raw']) {
      expect(screen.getByText(tag)).toBeTruthy()
    }
  })

  it('clicking the raw entry picks cli-raw', () => {
    const onPick = vi.fn()
    render(<AgentPicker onPick={onPick} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText('raw'))
    expect(onPick).toHaveBeenCalledWith('cli-raw')
  })
})
