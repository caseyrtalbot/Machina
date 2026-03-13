import { useState, useCallback } from 'react'
import { colors, typography, transitions } from '../../design/tokens'

interface WelcomeScreenProps {
  onVaultSelected: (path: string) => void
}

const ipcRenderer = window.electron.ipcRenderer

async function selectFolder(): Promise<string | null> {
  return ipcRenderer.invoke('fs:select-vault')
}

async function initVault(vaultPath: string): Promise<void> {
  await ipcRenderer.invoke('vault:init', { vaultPath })
}

export function WelcomeScreen({ onVaultSelected }: WelcomeScreenProps) {
  const [hoveredButton, setHoveredButton] = useState<'create' | 'open' | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleCreateVault = useCallback(async () => {
    if (isLoading) return
    setIsLoading(true)
    try {
      const path = await selectFolder()
      if (path) {
        await initVault(path)
        onVaultSelected(path)
      }
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, onVaultSelected])

  const handleOpenFolder = useCallback(async () => {
    if (isLoading) return
    setIsLoading(true)
    try {
      const path = await selectFolder()
      if (path) {
        onVaultSelected(path)
      }
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, onVaultSelected])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.bg.base
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '40px'
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <h1
            style={{
              margin: 0,
              fontSize: '42px',
              fontWeight: 600,
              fontFamily: typography.fontFamily.display,
              color: colors.text.primary,
              letterSpacing: '-0.02em',
              lineHeight: 1.2
            }}
          >
            Thought Engine
          </h1>
          <p
            style={{
              margin: '12px 0 0',
              fontSize: '16px',
              fontFamily: typography.fontFamily.body,
              color: colors.text.secondary,
              lineHeight: 1.5
            }}
          >
            Your local-first knowledge engine
          </p>
        </div>

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            width: '280px'
          }}
        >
          <button
            onClick={handleCreateVault}
            onMouseEnter={() => setHoveredButton('create')}
            onMouseLeave={() => setHoveredButton(null)}
            disabled={isLoading}
            style={{
              padding: '12px 24px',
              fontSize: '14px',
              fontWeight: 500,
              fontFamily: typography.fontFamily.body,
              color: '#FFFFFF',
              backgroundColor:
                hoveredButton === 'create' ? colors.accent.hover : colors.accent.default,
              border: 'none',
              borderRadius: '8px',
              cursor: isLoading ? 'default' : 'pointer',
              opacity: isLoading ? 0.6 : 1,
              transition: `background-color ${transitions.default}, opacity ${transitions.default}`,
              lineHeight: 1.5
            }}
          >
            Create New Vault
          </button>

          <button
            onClick={handleOpenFolder}
            onMouseEnter={() => setHoveredButton('open')}
            onMouseLeave={() => setHoveredButton(null)}
            disabled={isLoading}
            style={{
              padding: '12px 24px',
              fontSize: '14px',
              fontWeight: 500,
              fontFamily: typography.fontFamily.body,
              color: hoveredButton === 'open' ? colors.text.primary : colors.text.secondary,
              backgroundColor: 'transparent',
              border: `1px solid ${
                hoveredButton === 'open' ? colors.accent.default : colors.border.default
              }`,
              borderRadius: '8px',
              cursor: isLoading ? 'default' : 'pointer',
              opacity: isLoading ? 0.6 : 1,
              transition: `color ${transitions.default}, border-color ${transitions.default}, opacity ${transitions.default}`,
              lineHeight: 1.5
            }}
          >
            Open Existing Folder
          </button>
        </div>
      </div>
    </div>
  )
}
