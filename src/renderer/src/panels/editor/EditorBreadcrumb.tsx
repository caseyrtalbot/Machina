import { colors, transitions } from '../../design/tokens'

export interface BreadcrumbSegment {
  readonly name: string
  readonly path: string
  readonly isFile: boolean
}

export function parseBreadcrumb(filePath: string, vaultPath: string): readonly BreadcrumbSegment[] {
  const relative = filePath.startsWith(vaultPath)
    ? filePath.slice(vaultPath.length).replace(/^\//, '')
    : filePath

  const parts = relative.split('/').filter(Boolean)

  return parts.map((part, index): BreadcrumbSegment => {
    const isLast = index === parts.length - 1
    const builtPath = parts.slice(0, index + 1).join('/')
    return {
      name: isLast ? part.replace(/\.md$/, '') : part,
      path: builtPath,
      isFile: isLast && part.endsWith('.md')
    }
  })
}

interface NavButtonProps {
  onClick: () => void
  disabled: boolean
  title: string
  children: React.ReactNode
}

function NavButton({ onClick, disabled, title, children }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center justify-center w-5 h-5 rounded transition-colors"
      style={{
        color: disabled ? colors.text.muted : colors.text.secondary,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: transitions.default,
        backgroundColor: 'transparent',
        fontSize: 11
      }}
    >
      {children}
    </button>
  )
}

interface EditorBreadcrumbProps {
  filePath: string
  vaultPath: string
  canGoBack: boolean
  canGoForward: boolean
  onGoBack: () => void
  onGoForward: () => void
  onNavigate?: (path: string) => void
}

export function EditorBreadcrumb({
  filePath,
  vaultPath,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onNavigate
}: EditorBreadcrumbProps) {
  const segments = parseBreadcrumb(filePath, vaultPath)

  return (
    <div
      className="flex items-center gap-1 px-3 shrink-0"
      style={{
        height: 28,
        backgroundColor: colors.bg.surface,
        borderBottom: `1px solid ${colors.border.default}`
      }}
    >
      <NavButton onClick={onGoBack} disabled={!canGoBack} title="Go back">
        ‹
      </NavButton>
      <NavButton onClick={onGoForward} disabled={!canGoForward} title="Go forward">
        ›
      </NavButton>

      <div className="w-px h-3 mx-0.5" style={{ backgroundColor: colors.border.default }} />

      <div className="flex items-center gap-0.5 overflow-hidden">
        {segments.map((segment, index) => (
          <div key={segment.path} className="flex items-center gap-0.5 min-w-0">
            {index > 0 && <span style={{ color: colors.text.muted, fontSize: 11 }}>/</span>}
            <button
              onClick={() => onNavigate?.(segment.path)}
              className="truncate transition-colors"
              style={{
                color: index === segments.length - 1 ? colors.text.primary : colors.text.secondary,
                fontSize: 11,
                maxWidth: 120,
                background: 'transparent',
                cursor: onNavigate ? 'pointer' : 'default',
                transition: transitions.default
              }}
              title={segment.name}
            >
              {segment.name}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
