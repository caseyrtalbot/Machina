import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { createElement } from 'react'
import { ThemeProvider } from '../../src/renderer/src/design/Theme'
import { useSettingsStore } from '../../src/renderer/src/store/settings-store'
import { ENV_DEFAULTS, type EnvironmentSettings } from '../../src/renderer/src/design/themes'

function stubMatchMedia(matches = false): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  )
}

describe('ENV_DEFAULTS', () => {
  const allEnvKeys: readonly (keyof EnvironmentSettings)[] = [
    'canvasTranslucency',
    'cardOpacity',
    'cardHeaderDarkness',
    'cardBlur',
    'gridDotVisibility',
    'panelLightness',
    'activityBarOpacity',
    'cardTitleFontSize',
    'sidebarFontSize'
  ]

  it('dark defaults have panelLightness of 56', () => {
    expect(ENV_DEFAULTS.panelLightness).toBe(56)
  })

  it('all env keys are present in defaults', () => {
    for (const key of allEnvKeys) {
      expect(ENV_DEFAULTS).toHaveProperty(key)
      expect(typeof ENV_DEFAULTS[key]).toBe('number')
    }
  })
})

describe('ThemeProvider environment CSS vars', () => {
  beforeEach(() => {
    stubMatchMedia(false)
    localStorage.clear()
    document.documentElement.removeAttribute('style')
    useSettingsStore.setState({
      env: {
        ...ENV_DEFAULTS,
        activityBarOpacity: 34,
        sidebarFontSize: 15,
        cardBlur: 18,
        cardTitleFontSize: 14
      },
      displayFont: 'Inter',
      bodyFont: 'Inter',
      monoFont: 'JetBrains Mono',
      defaultEditorMode: 'rich',
      autosaveInterval: 1500,
      spellCheck: false
    })
  })

  afterEach(() => {
    cleanup()
    document.documentElement.removeAttribute('style')
  })

  it('applies shared environment variables for rail chrome and sidebar sizing', () => {
    render(createElement(ThemeProvider, null, createElement('div', null, 'themed')))

    const rootStyle = document.documentElement.style
    expect(rootStyle.getPropertyValue('--chrome-rail-bg')).toBe('rgba(18, 18, 20, 0.34)')
    expect(rootStyle.getPropertyValue('--env-card-blur')).toBe('18px')
    expect(rootStyle.getPropertyValue('--env-card-title-font-size')).toBe('14px')
    expect(rootStyle.getPropertyValue('--env-sidebar-font-size')).toBe('15px')
    expect(rootStyle.getPropertyValue('--env-sidebar-secondary-font-size')).toBe('14px')
    expect(rootStyle.getPropertyValue('--env-sidebar-tertiary-font-size')).toBe('12px')
  })
})

describe('v2 to v4 migration logic', () => {
  // The migration is embedded in Zustand persist config, so we replicate
  // the mapping logic here to test it in isolation.
  function migrateV2ToV4(state: Record<string, unknown>): Record<string, unknown> {
    const result = { ...state }

    // v2 → v3: migrate fontSize into env
    const oldFontSize = (result.fontSize as number | undefined) ?? 13
    result.env = { ...ENV_DEFAULTS, sidebarFontSize: oldFontSize }
    delete result.fontSize
    delete result.fontFamily

    // v3 → v4: strip removed fields
    delete result.theme
    delete result.accentColor
    delete result.terminalShell
    delete result.terminalFontSize
    delete result.scrollbackLines

    return result
  }

  it('preserves fontSize 15 as env.sidebarFontSize', () => {
    const result = migrateV2ToV4({ theme: 'midnight', fontSize: 15 })
    expect((result.env as EnvironmentSettings).sidebarFontSize).toBe(15)
  })

  it('defaults missing fontSize to 13 in env.sidebarFontSize', () => {
    const result = migrateV2ToV4({ theme: 'midnight' })
    expect((result.env as EnvironmentSettings).sidebarFontSize).toBe(13)
  })

  it('removes fontSize, fontFamily, theme, and accentColor from migrated state', () => {
    const result = migrateV2ToV4({
      theme: 'slate',
      fontSize: 14,
      fontFamily: 'Mono',
      accentColor: 'laser'
    })
    expect(result).not.toHaveProperty('fontSize')
    expect(result).not.toHaveProperty('fontFamily')
    expect(result).not.toHaveProperty('theme')
    expect(result).not.toHaveProperty('accentColor')
  })

  it('removes terminal settings from migrated state', () => {
    const result = migrateV2ToV4({
      theme: 'dark',
      terminalShell: '/bin/zsh',
      terminalFontSize: 14,
      scrollbackLines: 5000
    })
    expect(result).not.toHaveProperty('terminalShell')
    expect(result).not.toHaveProperty('terminalFontSize')
    expect(result).not.toHaveProperty('scrollbackLines')
  })
})
