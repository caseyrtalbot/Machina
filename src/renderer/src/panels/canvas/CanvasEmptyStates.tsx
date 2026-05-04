import { useCallback, useState } from 'react'
import { colors, transitions, typography } from '../../design/tokens'

export function CanvasWelcomeCard() {
  const [isHovered, setIsHovered] = useState(false)

  const handleOpenFolder = useCallback(async () => {
    const path = await window.api.fs.selectVault()
    if (path) {
      window.dispatchEvent(new CustomEvent('te:open-vault', { detail: path }))
    }
  }, [])

  return (
    <div
      className="absolute inset-0 flex items-center justify-center z-[1]"
      style={{ marginTop: -40 }}
    >
      <div
        style={{
          width: 360,
          padding: '32px 28px',
          borderRadius: 16,
          backgroundColor: 'var(--canvas-card-bg)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          border: '1px solid var(--canvas-card-border)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.25)'
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontFamily: typography.fontFamily.mono,
            color: colors.text.muted,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: 12
          }}
        >
          Machina
        </div>
        <h2
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 500,
            fontFamily: typography.fontFamily.display,
            color: colors.text.primary,
            lineHeight: 1.4,
            marginBottom: 8
          }}
        >
          Open a folder to get started.
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontFamily: typography.fontFamily.body,
            color: colors.text.secondary,
            lineHeight: 1.6,
            marginBottom: 24
          }}
        >
          Point Machina at any folder of markdown files. Your notes become an explorable knowledge
          graph with connections, clusters, and tensions.
        </p>
        <button
          type="button"
          onClick={handleOpenFolder}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{
            padding: '9px 20px',
            fontSize: 13,
            fontWeight: 500,
            fontFamily: typography.fontFamily.body,
            color: '#fff',
            backgroundColor: isHovered ? colors.accent.hover : colors.accent.default,
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            transition: `background-color ${transitions.default}`,
            lineHeight: 1.5
          }}
        >
          Open Folder
        </button>
      </div>
    </div>
  )
}
