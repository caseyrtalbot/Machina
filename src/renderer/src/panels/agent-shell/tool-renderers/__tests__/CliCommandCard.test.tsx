import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CliCommandCard } from '../CliCommandCard'
import type { ToolCall, ToolResult } from '@shared/thread-types'

type CliCommandCall = Extract<ToolCall, { kind: 'cli_command' }>

const call: CliCommandCall = {
  id: 'c1',
  kind: 'cli_command',
  args: { command: 'claude --print "hi"', cwd: '/v' }
}

const SECRET = 'sk-ant-' + 'a'.repeat(48)

function okResult(output: string): ToolResult {
  return { id: 'c1', ok: true, output: { output, exitCode: 0 } }
}

function expand() {
  fireEvent.click(screen.getByRole('button', { name: /claude --print/ }))
}

describe('CliCommandCard — secret masking', () => {
  it('masks secrets in the expanded output by default', () => {
    render(<CliCommandCard call={call} result={okResult(`token: ${SECRET}\ndone\n`)} />)
    expand()
    expect(screen.queryByText(new RegExp(SECRET))).toBeNull()
    expect(screen.getByText(/1 secret masked/i)).toBeTruthy()
    // The mask preserves length with bullet characters.
    expect(screen.getByText(new RegExp('•'.repeat(10)))).toBeTruthy()
  })

  it('reveals the secret only after the explicit toggle', () => {
    render(<CliCommandCard call={call} result={okResult(`token: ${SECRET}\n`)} />)
    expand()
    fireEvent.click(screen.getByTestId('cli-reveal-secrets'))
    expect(screen.getByText(new RegExp(SECRET))).toBeTruthy()
    expect(screen.getByText(/1 secret revealed/i)).toBeTruthy()
    fireEvent.click(screen.getByTestId('cli-reveal-secrets'))
    expect(screen.queryByText(new RegExp(SECRET))).toBeNull()
  })

  it('masks secrets carried in the error hint of a failed result', () => {
    const failed: ToolResult = {
      id: 'c1',
      ok: false,
      error: { code: 'IO_FATAL', message: 'exit 1', hint: `leaked ${SECRET}` }
    }
    render(<CliCommandCard call={call} result={failed} />)
    expand()
    expect(screen.queryByText(new RegExp(SECRET))).toBeNull()
    expect(screen.getByText(/1 secret masked/i)).toBeTruthy()
  })

  it('shows no masking chrome when the output has no secrets', () => {
    render(<CliCommandCard call={call} result={okResult('plain output\n')} />)
    expand()
    expect(screen.getByText(/plain output/)).toBeTruthy()
    expect(screen.queryByText(/secret/i)).toBeNull()
    expect(screen.queryByTestId('cli-reveal-secrets')).toBeNull()
  })
})
