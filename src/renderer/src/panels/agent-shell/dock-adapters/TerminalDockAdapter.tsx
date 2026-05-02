import { useMemo } from 'react'
import { useVaultStore } from '../../../store/vault-store'
import { colors } from '../../../design/tokens'

export function TerminalDockAdapter({ sessionId }: { readonly sessionId: string }) {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const preloadPath = useMemo(() => 'file://' + window.api.getTerminalPreloadPath(), [])
  const webviewSrc = useMemo(() => {
    const params = new URLSearchParams()
    if (sessionId) params.set('sessionId', sessionId)
    if (vaultPath) params.set('vaultPath', vaultPath)
    const base = import.meta.env.DEV
      ? new URL('/terminal-webview/index.html', window.location.origin).href
      : new URL('./terminal-webview/index.html', window.location.href).href
    const qs = params.toString()
    return qs ? `${base}?${qs}` : base
  }, [sessionId, vaultPath])

  if (!sessionId) {
    return (
      <div style={{ padding: 24, color: colors.text.muted, fontSize: 13 }}>
        no terminal session attached yet
      </div>
    )
  }

  /* eslint-disable react/no-unknown-property */
  return (
    <webview
      src={webviewSrc}
      preload={preloadPath}
      style={{ width: '100%', height: '100%' }}
      webpreferences="contextIsolation=yes, sandbox=yes"
    />
  )
  /* eslint-enable react/no-unknown-property */
}
