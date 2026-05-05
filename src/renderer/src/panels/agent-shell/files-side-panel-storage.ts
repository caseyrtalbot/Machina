const OPEN_STORAGE_KEY = 'te.files-side-panel-open'
const WIDTH_STORAGE_KEY = 'te.files-side-panel-width'

export const FILES_PANEL_DEFAULT_WIDTH = 360
export const FILES_PANEL_MIN_WIDTH = 280
export const FILES_PANEL_MAX_WIDTH = 720

export function readPersistedFilesPanelOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function persistFilesPanelOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_STORAGE_KEY, open ? '1' : '0')
  } catch {
    /* localStorage unavailable; non-fatal */
  }
}

export function readPersistedFilesPanelWidth(): number {
  try {
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY)
    if (!raw) return FILES_PANEL_DEFAULT_WIDTH
    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed)) return FILES_PANEL_DEFAULT_WIDTH
    return clampFilesPanelWidth(parsed)
  } catch {
    return FILES_PANEL_DEFAULT_WIDTH
  }
}

export function persistFilesPanelWidth(width: number): void {
  try {
    window.localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(width)))
  } catch {
    /* localStorage unavailable; non-fatal */
  }
}

export function clampFilesPanelWidth(width: number): number {
  if (width < FILES_PANEL_MIN_WIDTH) return FILES_PANEL_MIN_WIDTH
  if (width > FILES_PANEL_MAX_WIDTH) return FILES_PANEL_MAX_WIDTH
  return Math.round(width)
}
