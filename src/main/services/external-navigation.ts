import type { WebContents } from 'electron'

interface ExternalNavigationDeps {
  readonly openExternal: (url: string) => void | Promise<void>
  readonly rendererUrl?: string
}

type NavigationTarget = Pick<WebContents, 'setWindowOpenHandler' | 'on'>

function callOpenExternalSafely(
  openExternal: (url: string) => void | Promise<void>,
  url: string
): void {
  void Promise.resolve(openExternal(url)).catch(() => {
    // Best effort: navigation is still denied even if the shell call fails.
  })
}

export function isExternalHttpNavigation(url: string, rendererUrl?: string): boolean {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false
  }

  if (!rendererUrl) {
    return true
  }

  try {
    return parsed.origin !== new URL(rendererUrl).origin
  } catch {
    return !url.startsWith(rendererUrl)
  }
}

export function attachExternalNavigationGuards(
  contents: NavigationTarget,
  deps: ExternalNavigationDeps
): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalHttpNavigation(url, deps.rendererUrl)) {
      callOpenExternalSafely(deps.openExternal, url)
    }
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (!isExternalHttpNavigation(url, deps.rendererUrl)) {
      return
    }

    event.preventDefault()
    callOpenExternalSafely(deps.openExternal, url)
  })
}
