export interface WindowState {
  readonly width: number
  readonly height: number
  readonly x?: number
  readonly y?: number
  readonly isMaximized?: boolean
}

export interface DisplayLike {
  readonly workArea: {
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  }
}

export interface WindowStateTarget {
  getNormalBounds(): { x: number; y: number; width: number; height: number }
  isMaximized(): boolean
}

export const DEFAULT_MAIN_WINDOW_STATE: WindowState = {
  width: 1280,
  height: 800
}

function hasSavedBounds(
  state: WindowState
): state is WindowState & Required<Pick<WindowState, 'x' | 'y' | 'width' | 'height'>> {
  return (
    typeof state.x === 'number' &&
    typeof state.y === 'number' &&
    typeof state.width === 'number' &&
    typeof state.height === 'number'
  )
}

export function boundsVisibleOnAnyDisplay(
  bounds: Required<Pick<WindowState, 'x' | 'y' | 'width' | 'height'>>,
  displays: readonly DisplayLike[]
): boolean {
  return displays.some((display) => {
    const area = display.workArea
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    )
  })
}

export function resolveInitialWindowState(
  savedState: WindowState | null | undefined,
  displays: readonly DisplayLike[],
  fallback: WindowState = DEFAULT_MAIN_WINDOW_STATE
): WindowState {
  if (!savedState) {
    return fallback
  }

  if (!hasSavedBounds(savedState)) {
    return { ...fallback, ...savedState }
  }

  if (savedState.isMaximized || boundsVisibleOnAnyDisplay(savedState, displays)) {
    return savedState
  }

  return fallback
}

export function captureWindowState(window: WindowStateTarget): Required<WindowState> {
  const { x, y, width, height } = window.getNormalBounds()
  return {
    x,
    y,
    width,
    height,
    isMaximized: window.isMaximized()
  }
}
