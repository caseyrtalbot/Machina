/**
 * BlockDetector — pure state machine that converts a stream of PTY bytes
 * into structured BlockEvents based on the te- OSC marker protocol.
 *
 * See docs/architecture/block-protocol.md for the wire format.
 *
 * Pure: no I/O, no globals. Carries a small partial-OSC buffer between
 * consume() calls so a marker split across two chunks isn't dropped.
 */

const ESC = '\x1b'
const BEL = '\x07'
const ST = '\x1b\\' // String Terminator alternative for OSC

const OSC_INTRODUCER = `${ESC}]1337;`
const TE_PAYLOAD_PREFIX = 'te-'

export type BlockEvent =
  | { readonly kind: 'prompt-start' }
  | {
      readonly kind: 'command-start'
      readonly cwd: string
      readonly ts: number
      readonly meta: Readonly<Record<string, string>>
    }
  | { readonly kind: 'command-end'; readonly exit: number; readonly ts: number }
  | { readonly kind: 'output-chunk'; readonly text: string }

export interface BlockDetector {
  consume(chunk: Uint8Array | string): readonly BlockEvent[]
}

export function createBlockDetector(): BlockDetector {
  let buffer = ''

  function flushOutput(text: string, into: BlockEvent[]): void {
    if (text.length === 0) return
    into.push({ kind: 'output-chunk', text })
  }

  function parseTePayload(payload: string): BlockEvent | null {
    // Strip the leading te- prefix; first segment is the verb, rest are kv pairs.
    const body = payload.slice(TE_PAYLOAD_PREFIX.length)
    const parts = body.split(';')
    const verb = parts[0]
    const kv: Record<string, string> = {}
    for (let i = 1; i < parts.length; i++) {
      const seg = parts[i]
      const eq = seg.indexOf('=')
      if (eq < 0) continue
      const key = seg.slice(0, eq)
      const value = seg.slice(eq + 1)
      kv[key] = value
    }

    switch (verb) {
      case 'prompt-start':
        return { kind: 'prompt-start' }
      case 'command-start': {
        const cwd = kv.cwd
        const tsRaw = kv.ts
        if (cwd === undefined || tsRaw === undefined) return null
        const ts = Number(tsRaw)
        if (!Number.isFinite(ts)) return null
        const { cwd: _cwd, ts: _ts, ...rest } = kv
        return { kind: 'command-start', cwd, ts, meta: rest }
      }
      case 'command-end': {
        const exitRaw = kv.exit
        const tsRaw = kv.ts
        if (exitRaw === undefined || tsRaw === undefined) return null
        const exit = Number(exitRaw)
        const ts = Number(tsRaw)
        if (!Number.isFinite(exit) || !Number.isFinite(ts)) return null
        return { kind: 'command-end', exit, ts }
      }
      default:
        return null
    }
  }

  function consume(chunk: Uint8Array | string): readonly BlockEvent[] {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')
    buffer += text
    const events: BlockEvent[] = []

    while (true) {
      const introIdx = buffer.indexOf(OSC_INTRODUCER)
      if (introIdx === -1) {
        // No full introducer visible. Flush everything except a possible
        // partial-introducer suffix starting at the last ESC.
        const lastEsc = buffer.lastIndexOf(ESC)
        const couldBePartial = lastEsc !== -1 && OSC_INTRODUCER.startsWith(buffer.slice(lastEsc))
        const safe = couldBePartial ? lastEsc : buffer.length
        flushOutput(buffer.slice(0, safe), events)
        buffer = buffer.slice(safe)
        return events
      }

      // Output anything before the introducer.
      flushOutput(buffer.slice(0, introIdx), events)
      buffer = buffer.slice(introIdx)

      // Find terminator (BEL or ST).
      const payloadStart = OSC_INTRODUCER.length
      const belIdx = buffer.indexOf(BEL, payloadStart)
      const stIdx = buffer.indexOf(ST, payloadStart)
      const termIdx = belIdx === -1 ? stIdx : stIdx === -1 ? belIdx : Math.min(belIdx, stIdx)

      if (termIdx === -1) {
        // Marker incomplete; wait for more bytes.
        return events
      }

      const payload = buffer.slice(payloadStart, termIdx)
      const termLen = buffer.startsWith(ST, termIdx) ? ST.length : BEL.length
      const fullMarker = buffer.slice(0, termIdx + termLen)
      buffer = buffer.slice(termIdx + termLen)

      if (payload.startsWith(TE_PAYLOAD_PREFIX)) {
        const ev = parseTePayload(payload)
        if (ev !== null) {
          events.push(ev)
        }
        // Malformed te- payload: drop silently (per spec — never stall).
      } else {
        // Foreign OSC 1337 (e.g. iTerm2 CurrentDir): pass through verbatim.
        flushOutput(fullMarker, events)
      }
    }
  }

  return { consume }
}
