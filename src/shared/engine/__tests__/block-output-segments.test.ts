import { describe, it, expect } from 'vitest'
import { segmentOutput, maskSegmentText } from '../block-output-segments'
import type { SecretRef } from '../block-model'

describe('segmentOutput', () => {
  it('returns empty array for empty text', () => {
    expect(segmentOutput('', [])).toEqual([])
  })

  it('returns the whole text when there are no secrets', () => {
    const out = segmentOutput('hello world', [])
    expect(out).toEqual([{ text: 'hello world', secret: null }])
  })

  it('splits a single mid-text secret into before/secret/after', () => {
    const text = 'token=ABCDEF rest'
    const secret: SecretRef = { start: 6, end: 12, kind: 'aws-key' }
    const out = segmentOutput(text, [secret])
    expect(out).toHaveLength(3)
    expect(out[0]).toEqual({ text: 'token=', secret: null })
    expect(out[1].text).toBe('ABCDEF')
    expect(out[1].secret?.kind).toBe('aws-key')
    expect(out[2]).toEqual({ text: ' rest', secret: null })
  })

  it('handles multiple secrets in order', () => {
    const text = 'AAAA BBBB CCCC'
    const secrets: SecretRef[] = [
      { start: 0, end: 4, kind: 'k1' },
      { start: 5, end: 9, kind: 'k2' },
      { start: 10, end: 14, kind: 'k3' }
    ]
    const out = segmentOutput(text, secrets)
    expect(out.map((s) => s.text)).toEqual(['AAAA', ' ', 'BBBB', ' ', 'CCCC'])
    expect(out.filter((s) => s.secret).map((s) => s.secret!.kind)).toEqual(['k1', 'k2', 'k3'])
  })

  it('sorts unordered secrets', () => {
    const text = 'AAAA BBBB'
    const secrets: SecretRef[] = [
      { start: 5, end: 9, kind: 'b' },
      { start: 0, end: 4, kind: 'a' }
    ]
    const out = segmentOutput(text, secrets)
    expect(out.map((s) => s.secret?.kind ?? '·')).toEqual(['a', '·', 'b'])
  })

  it('clamps secrets that extend past the text', () => {
    const text = 'short'
    const secret: SecretRef = { start: 2, end: 99, kind: 'k' }
    const out = segmentOutput(text, [secret])
    expect(out).toEqual([
      { text: 'sh', secret: null },
      { text: 'ort', secret }
    ])
  })

  it('skips zero-width secret ranges', () => {
    const text = 'hello'
    const secret: SecretRef = { start: 2, end: 2, kind: 'k' }
    const out = segmentOutput(text, [secret])
    expect(out).toEqual([{ text: 'hello', secret: null }])
  })
})

describe('maskSegmentText', () => {
  it('produces a glyph string of the same character length', () => {
    expect(maskSegmentText('abcd').length).toBe(4)
    expect(maskSegmentText('').length).toBe(0)
    expect(maskSegmentText('a')).toBe('•')
  })
})
