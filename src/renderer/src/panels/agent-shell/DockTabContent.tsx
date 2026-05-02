import type { DockTab } from '@shared/dock-types'
import { colors } from '../../design/tokens'

export function DockTabContent({ tab }: { readonly tab: DockTab }) {
  return <div style={{ padding: 24, color: colors.text.muted }}>placeholder for {tab.kind}</div>
}
