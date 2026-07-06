/**
 * Pure builders for the terminal <webview> src URL (workstation step 4).
 * TerminalApp (the webview guest) reads these query params; keep the names in
 * sync with readUrlParams in src/renderer/terminal-webview/TerminalApp.tsx.
 *
 * Always pass `cwd` alongside `sessionId`: reconnect ignores it, but when the
 * persisted sessionId is stale the guest falls through to terminal:create and
 * cwd is what makes the respawn land in the right directory.
 */
export interface TerminalWebviewParams {
  readonly sessionId?: string
  readonly cwd?: string
  readonly vaultPath?: string
  readonly initialCommand?: string
  readonly label?: string
  readonly accent?: string
  readonly bg?: string
  readonly systemPrompt?: string
}

export function buildTerminalWebviewSrc(base: string, params: TerminalWebviewParams): string {
  const qs = new URLSearchParams()
  if (params.sessionId) qs.set('sessionId', params.sessionId)
  if (params.cwd) qs.set('cwd', params.cwd)
  if (params.initialCommand) qs.set('initialCommand', params.initialCommand)
  if (params.label) qs.set('label', params.label)
  if (params.vaultPath) qs.set('vaultPath', params.vaultPath)
  if (params.accent) qs.set('accent', params.accent)
  if (params.bg) qs.set('bg', params.bg)
  if (params.systemPrompt) qs.set('systemPrompt', params.systemPrompt)
  const q = qs.toString()
  return q ? `${base}?${q}` : base
}

/**
 * Resolve the webview entry URL. In dev, electron-vite serves multi-page
 * entries under the renderer dev-server origin; in prod the entry sits next
 * to the current renderer file.
 */
export function resolveTerminalWebviewBase(isDev: boolean, origin: string, href: string): string {
  return isDev
    ? new URL('/terminal-webview/index.html', origin).href
    : new URL('./terminal-webview/index.html', href).href
}
