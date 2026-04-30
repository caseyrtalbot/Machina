import { describe, it, expect } from 'vitest'
import { scanSecrets } from '../secrets'

describe('scanSecrets', () => {
  it('returns no matches for empty input', () => {
    expect(scanSecrets('')).toEqual([])
  })

  it('returns no matches for plain prose', () => {
    expect(scanSecrets('The quick brown fox jumps over the lazy dog 12345.')).toEqual([])
  })

  describe('per-kind detection', () => {
    it('flags an OpenAI key (sk- followed by 32+ alphanumerics)', () => {
      const sample = 'sk-' + 'A'.repeat(40)
      const text = `before ${sample} after`
      const refs = scanSecrets(text)
      expect(refs).toHaveLength(1)
      expect(refs[0]).toEqual({
        kind: 'openai',
        start: text.indexOf(sample),
        end: text.indexOf(sample) + sample.length
      })
    })

    it('flags an Anthropic key and prefers anthropic over openai for sk-ant-', () => {
      const sample = 'sk-ant-' + 'A'.repeat(50)
      const text = `prefix ${sample} suffix`
      const refs = scanSecrets(text)
      expect(refs).toHaveLength(1)
      expect(refs[0].kind).toBe('anthropic')
      expect(refs[0].start).toBe(text.indexOf(sample))
      expect(refs[0].end).toBe(text.indexOf(sample) + sample.length)
    })

    it('flags an AWS access key (AKIA + 16 uppercase alphanumerics)', () => {
      const sample = 'AKIAIOSFODNN7EXAMPLE'
      const text = `using ${sample} for s3`
      const refs = scanSecrets(text)
      expect(refs).toHaveLength(1)
      expect(refs[0].kind).toBe('aws-access')
    })

    it('flags an AWS secret-shaped string when assigned to AWS_SECRET_ACCESS_KEY', () => {
      const sample = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
      const text = `AWS_SECRET_ACCESS_KEY=${sample}`
      const refs = scanSecrets(text)
      const awsSecret = refs.find((r) => r.kind === 'aws-secret')
      expect(awsSecret).toBeDefined()
    })

    it('flags a GitHub PAT (ghp_ + 36 alphanumerics)', () => {
      const sample = 'ghp_' + 'a'.repeat(36)
      const text = `token=${sample}`
      const refs = scanSecrets(text)
      const hit = refs.find((r) => r.kind === 'github-pat')
      expect(hit).toBeDefined()
      expect(text.slice(hit!.start, hit!.end)).toBe(sample)
    })

    it('flags a JWT-shaped triple (eyJ.eyJ.…)', () => {
      const sample = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc-def_GHI'
      const text = `Authorization: Bearer ${sample}`
      const refs = scanSecrets(text)
      const hit = refs.find((r) => r.kind === 'jwt')
      expect(hit).toBeDefined()
      expect(text.slice(hit!.start, hit!.end)).toBe(sample)
    })

    it('flags generic provider env-var assignments', () => {
      const text = 'export OPENAI_API_KEY=hunter2-not-really-a-key'
      const refs = scanSecrets(text)
      const hit = refs.find((r) => r.kind === 'env-var-key')
      expect(hit).toBeDefined()
      expect(text.slice(hit!.start, hit!.end)).toBe('OPENAI_API_KEY=hunter2-not-really-a-key')
    })
  })

  describe('overlap resolution', () => {
    it('prefers the more specific kind when matches overlap (sk-ant beats sk-)', () => {
      const sample = 'sk-ant-' + 'X'.repeat(60)
      const refs = scanSecrets(sample)
      expect(refs).toHaveLength(1)
      expect(refs[0].kind).toBe('anthropic')
    })

    it('returns matches sorted by start position', () => {
      const a = 'AKIAIOSFODNN7EXAMPLE'
      const b = 'sk-' + 'B'.repeat(40)
      const text = `${a} then ${b}`
      const refs = scanSecrets(text)
      expect(refs).toHaveLength(2)
      expect(refs[0].start).toBeLessThan(refs[1].start)
      expect(refs[0].kind).toBe('aws-access')
      expect(refs[1].kind).toBe('openai')
    })

    it('is idempotent across calls', () => {
      const sample = `key sk-${'C'.repeat(40)} and AKIAIOSFODNN7EXAMPLE`
      const a = scanSecrets(sample)
      const b = scanSecrets(sample)
      expect(a).toEqual(b)
    })
  })
})
