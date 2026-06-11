import { describe, it, expect } from 'vitest'
import { dailyNotePath, localDateStr } from '../../../../utils/daily-notes'

/**
 * Pure path-builder coverage for the daily-note wiring added in
 * FilesDockAdapter (plan item 3.5): <vaultPath>/<dailyNoteFolder>/<date>.md.
 */
describe('daily note path builder', () => {
  it('builds <vault>/<folder>/<date>.md', () => {
    expect(dailyNotePath('/v/vault', 'daily', '2026-06-09')).toBe('/v/vault/daily/2026-06-09.md')
  })

  it('respects a custom dailyNoteFolder setting, including nested folders', () => {
    expect(dailyNotePath('/v/vault', 'journal', '2026-06-09')).toBe(
      '/v/vault/journal/2026-06-09.md'
    )
    expect(dailyNotePath('/v/vault', 'journal/2026', '2026-06-09')).toBe(
      '/v/vault/journal/2026/2026-06-09.md'
    )
  })

  it('formats dates as zero-padded local YYYY-MM-DD', () => {
    // Jan 5 at noon local time — both month and day need padding.
    const d = new Date(2026, 0, 5, 12, 0, 0)
    expect(localDateStr(d)).toBe('2026-01-05')
  })

  it('composes date formatting with the path builder', () => {
    const d = new Date(2026, 11, 31, 12, 0, 0)
    expect(dailyNotePath('/v/vault', 'daily', localDateStr(d))).toBe('/v/vault/daily/2026-12-31.md')
  })
})
