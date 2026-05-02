import { useEffect } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { useThreadStore } from '../../store/thread-store'
import { useThreadStreaming } from '../../hooks/use-thread-streaming'
import { ThreadSidebar } from './ThreadSidebar'
import { ThreadPanel } from './ThreadPanel'
import { SurfaceDock } from './SurfaceDock'

export interface AgentShellProps {
  readonly onOpenSettings?: () => void
}

export function AgentShell({ onOpenSettings }: AgentShellProps = {}) {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const setVaultPath = useThreadStore((s) => s.setVaultPath)
  const loadThreads = useThreadStore((s) => s.loadThreads)

  useEffect(() => {
    if (!vaultPath) return
    setVaultPath(vaultPath)
    void loadThreads()
  }, [vaultPath, setVaultPath, loadThreads])

  useThreadStreaming()

  return (
    <div data-testid="agent-shell" style={{ display: 'flex', height: '100%', width: '100%' }}>
      <ThreadSidebar onOpenSettings={onOpenSettings} />
      <ThreadPanel />
      <SurfaceDock />
    </div>
  )
}
