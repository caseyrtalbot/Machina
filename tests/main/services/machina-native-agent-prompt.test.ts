// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TE_DIR } from '../../../src/shared/constants'

// machina-native-agent pulls in electron via typed-ipc / window-registry /
// anthropic-key; only resolveSystemPrompt is under test here.
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { handle: () => {} },
  BrowserWindow: class {}
}))

import {
  resolveSystemPrompt,
  DEFAULT_SYSTEM_PROMPT
} from '../../../src/main/services/machina-native-agent'

describe('machina-native-agent system prompt (main-owned, 2.2)', () => {
  it('falls back to the built-in default when no override file exists', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mna-'))
    try {
      expect(await resolveSystemPrompt(v)).toBe(DEFAULT_SYSTEM_PROMPT)
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it(`uses ${TE_DIR}/agent-prompt.md when present and non-empty`, async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mna-'))
    try {
      mkdirSync(path.join(v, TE_DIR), { recursive: true })
      writeFileSync(path.join(v, TE_DIR, 'agent-prompt.md'), 'You are a custom prompt.\n')
      expect(await resolveSystemPrompt(v)).toBe('You are a custom prompt.\n')
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('treats a whitespace-only override as absent', async () => {
    const v = mkdtempSync(path.join(tmpdir(), 'mna-'))
    try {
      mkdirSync(path.join(v, TE_DIR), { recursive: true })
      writeFileSync(path.join(v, TE_DIR, 'agent-prompt.md'), '  \n\n')
      expect(await resolveSystemPrompt(v)).toBe(DEFAULT_SYSTEM_PROMPT)
    } finally {
      rmSync(v, { recursive: true, force: true })
    }
  })

  it('default prompt covers vault structure, wikilinks, canvas, and read-before-write', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('[[')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('canvasId "default"')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('read before write')
    expect(DEFAULT_SYSTEM_PROMPT).toContain(TE_DIR)
  })
})
