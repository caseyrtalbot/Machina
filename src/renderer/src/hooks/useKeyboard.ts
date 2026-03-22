import { useEffect } from 'react'

interface KeyboardConfig {
  onToggleSidebar?: () => void
  onNewNote?: () => void
  onCycleView?: () => void
  onToggleSourceMode?: () => void
  onCommandPalette?: () => void
  onSave?: () => void
  onNewTerminalTab?: () => void
  onCloseTab?: () => void
  onGoBack?: () => void
  onGoForward?: () => void
  onEscape?: () => void
}

const META_KEY_BINDINGS = [
  { key: 'b', handler: 'onToggleSidebar' },
  { key: 'n', handler: 'onNewNote' },
  { key: 'g', handler: 'onCycleView' },
  { key: '/', handler: 'onToggleSourceMode' },
  { key: 'k', handler: 'onCommandPalette' },
  { key: 's', handler: 'onSave' },
  { key: 't', handler: 'onNewTerminalTab' },
  { key: 'w', handler: 'onCloseTab' },
  { key: '[', handler: 'onGoBack' },
  { key: ']', handler: 'onGoForward' }
] as const satisfies ReadonlyArray<{ key: string; handler: keyof KeyboardConfig }>

export function useKeyboard(config: KeyboardConfig): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && config.onEscape) {
        e.preventDefault()
        config.onEscape()
        return
      }

      if (!e.metaKey) return

      for (const binding of META_KEY_BINDINGS) {
        if (e.key === binding.key) {
          const handler = config[binding.handler]
          if (handler) {
            e.preventDefault()
            handler()
          }
          return
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [config])
}
