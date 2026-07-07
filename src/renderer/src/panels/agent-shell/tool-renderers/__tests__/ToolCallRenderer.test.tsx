import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ToolCallRenderer } from '../ToolCallRenderer'
import type { ToolCall, ToolResult } from '@shared/thread-types'

const unknownCall: ToolCall = {
  id: 'u1',
  kind: 'cli_codex_command_execution',
  args: { preview: 'ls -la /tmp' }
}

describe('ToolCallRenderer — unknown-tool pill', () => {
  it('shows the args preview on the pill', () => {
    render(
      <ToolCallRenderer
        call={unknownCall}
        result={{ id: 'u1', ok: true, output: { preview: 'ls -la /tmp' } }}
      />
    )
    expect(screen.getByText('ls -la /tmp')).toBeTruthy()
    expect(screen.getByText(/tool: cli_codex_command_execution ok/i)).toBeTruthy()
  })

  it('routes a failed result to the error card, never an "ok" pill', () => {
    const failed: ToolResult = {
      id: 'u1',
      ok: false,
      error: { code: 'IO_FATAL', message: 'boom' }
    }
    render(<ToolCallRenderer call={unknownCall} result={failed} />)
    expect(screen.getByText('boom')).toBeTruthy()
    expect(screen.queryByText(/ok/)).toBeNull()
  })

  it('masks secrets in the args preview on the pill', () => {
    const secret = `sk-ant-${'a'.repeat(40)}`
    const call: ToolCall = {
      id: 'u2',
      kind: 'cli_codex_command_execution',
      args: { preview: `curl -H 'Authorization: Bearer ${secret}'` }
    }
    render(<ToolCallRenderer call={call} />)
    expect(screen.queryByText(new RegExp(secret))).toBeNull()
    expect(screen.getByText(/•+/)).toBeTruthy()
  })

  it('masks secrets in the error card message and hint', () => {
    const secret = `sk-ant-${'b'.repeat(40)}`
    const failed: ToolResult = {
      id: 'u1',
      ok: false,
      error: {
        code: 'IO_FATAL',
        message: `auth failed: ${secret}`,
        hint: `token ${secret} rejected`
      }
    }
    render(<ToolCallRenderer call={unknownCall} result={failed} />)
    expect(screen.queryByText(new RegExp(secret))).toBeNull()
    expect(screen.getAllByText(/•+/).length).toBeGreaterThanOrEqual(2)
  })

  it('shows result-less cli_ trace entries as observed', () => {
    render(<ToolCallRenderer call={unknownCall} />)
    expect(screen.getByText(/observed/)).toBeTruthy()
  })

  it('shows result-less non-cli calls as pending live, not run in history', () => {
    const call: ToolCall = { id: 'x1', kind: 'list_canvases', args: {} }
    const live = render(<ToolCallRenderer call={call} />)
    expect(screen.getByText(/pending/)).toBeTruthy()
    live.unmount()
    render(<ToolCallRenderer call={call} historical />)
    expect(screen.getByText(/not run/)).toBeTruthy()
  })
})

describe('ToolCallRenderer — historical approval cards', () => {
  const writeCall: ToolCall = {
    id: 'w1',
    kind: 'write_note',
    args: { path: 'note.md', content: 'body' }
  }

  it('keeps Accept/Reject on a live result-less write_note', () => {
    render(<ToolCallRenderer call={writeCall} />)
    expect(screen.getByRole('button', { name: /accept/i })).toBeTruthy()
    expect(screen.getByText('awaiting approval')).toBeTruthy()
  })

  it('drops Accept/Reject and shows "not run" on a historical write_note', () => {
    render(<ToolCallRenderer call={writeCall} historical />)
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull()
    expect(screen.getByText('not run')).toBeTruthy()
  })

  it('drops Accept/Reject and shows "not run" on a historical edit_note', () => {
    const editCall: ToolCall = {
      id: 'e1',
      kind: 'edit_note',
      args: { path: 'note.md', find: 'a', replace: 'b' }
    }
    render(<ToolCallRenderer call={editCall} historical />)
    expect(screen.queryByRole('button', { name: /accept/i })).toBeNull()
    expect(screen.getByText('not run')).toBeTruthy()
  })
})
