/**
 * Minimal POSIX path utilities for use in browser/Web Worker contexts.
 * Replaces Node's `path` module in the shared engine kernel.
 */

export const sep = '/'

export function basename(p: string, ext?: string): string {
  const last = p.endsWith('/') ? p.slice(0, -1) : p
  const base = last.slice(last.lastIndexOf('/') + 1)
  if (ext && base.endsWith(ext)) return base.slice(0, -ext.length)
  return base
}

export function dirname(p: string): string {
  const idx = p.lastIndexOf('/')
  if (idx <= 0) return idx === 0 ? '/' : '.'
  return p.slice(0, idx)
}

export function extname(p: string): string {
  const base = basename(p)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot)
}

export function join(...segments: string[]): string {
  return normalize(segments.filter(Boolean).join('/'))
}

export function resolve(...segments: string[]): string {
  let result = ''
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i]
    if (!seg) continue
    result = result ? `${seg}/${result}` : seg
    if (seg.startsWith('/')) break
  }
  return normalize(result)
}

export function relative(from: string, to: string): string {
  const fromParts = normalize(from).split('/').filter(Boolean)
  const toParts = normalize(to).split('/').filter(Boolean)

  let common = 0
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++
  }

  const ups = fromParts.length - common
  const rest = toParts.slice(common)
  return [...Array<string>(ups).fill('..'), ...rest].join('/') || '.'
}

function normalize(p: string): string {
  const isAbsolute = p.startsWith('/')
  const parts = p.split('/').filter(Boolean)
  const result: string[] = []

  for (const part of parts) {
    if (part === '.') continue
    if (part === '..') {
      if (result.length > 0 && result[result.length - 1] !== '..') {
        result.pop()
      } else if (!isAbsolute) {
        result.push('..')
      }
    } else {
      result.push(part)
    }
  }

  return (isAbsolute ? '/' : '') + result.join('/')
}
