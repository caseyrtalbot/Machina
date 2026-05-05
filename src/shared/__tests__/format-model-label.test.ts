import { describe, expect, it } from 'vitest'
import { formatModelLabel } from '../format-model-label'

describe('formatModelLabel', () => {
  it('renders Anthropic model ids with dotted versions', () => {
    expect(formatModelLabel('claude-sonnet-4-6')).toBe('Sonnet 4.6')
    expect(formatModelLabel('claude-opus-4-7')).toBe('Opus 4.7')
    expect(formatModelLabel('claude-haiku-4-5')).toBe('Haiku 4.5')
  })

  it('handles ids without a claude- prefix', () => {
    expect(formatModelLabel('sonnet-4-6')).toBe('Sonnet 4.6')
  })

  it('handles ids without a version suffix', () => {
    expect(formatModelLabel('claude-opus')).toBe('Opus')
    expect(formatModelLabel('Agent')).toBe('Agent')
  })

  it('keeps multi-word names as spaces and version as dots', () => {
    expect(formatModelLabel('claude-haiku-mini-4-5-1')).toBe('Haiku Mini 4.5.1')
  })
})
