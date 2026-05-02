import { useState } from 'react'
import {
  ContextMenu,
  type ContextMenuItem,
  type ContextMenuPosition
} from '../../../components/ContextMenu'

export function useToolCardMenu(items: readonly ContextMenuItem[]): {
  onContextMenu: (e: React.MouseEvent) => void
  menu: React.ReactNode
} {
  const [pos, setPos] = useState<ContextMenuPosition | null>(null)
  return {
    onContextMenu: (e) => {
      e.preventDefault()
      e.stopPropagation()
      setPos({ x: e.clientX, y: e.clientY })
    },
    menu: pos ? <ContextMenu position={pos} onClose={() => setPos(null)} items={items} /> : null
  }
}

export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      // clipboard may be blocked in test env; fall through silently
    }
  }
}
