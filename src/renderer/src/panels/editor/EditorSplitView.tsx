import { useEditorStore } from '../../store/editor-store'
import { useVaultStore } from '../../store/vault-store'
import { EditorPanel } from './EditorPanel'

interface EditorSplitViewProps {
  onNavigate: (id: string) => void
}

export function EditorSplitView({ onNavigate }: EditorSplitViewProps) {
  const openTabs = useEditorStore((s) => s.openTabs)
  const activeNotePath = useEditorStore((s) => s.activeNotePath)
  const previewTabPath = useEditorStore((s) => s.previewTabPath)
  const isDirty = useEditorStore((s) => s.isDirty)
  const switchTab = useEditorStore((s) => s.switchTab)
  const closeTab = useEditorStore((s) => s.closeTab)
  const pinPreviewTab = useEditorStore((s) => s.pinPreviewTab)
  const vaultPath = useVaultStore((s) => s.vaultPath)

  const showTabBar = openTabs.length > 1

  const handleNewFile = async () => {
    if (!vaultPath) return
    const now = new Date().toISOString().slice(0, 10)
    const title = `Untitled ${now}`
    const filePath = `${vaultPath}/${title}.md`
    const exists = await window.api.fs.fileExists(filePath)
    if (!exists) {
      const content = `---\ntitle: ${title}\ncreated: ${now}\ntags: []\n---\n\n`
      await window.api.fs.writeFile(filePath, content)
    }
    useEditorStore.getState().openTab(filePath, title)
  }

  const handleCloseAll = () => {
    const tabs = useEditorStore.getState().openTabs
    for (const tab of tabs) {
      useEditorStore.getState().closeTab(tab.path)
    }
  }

  return (
    <div className="editor-tabbed-container">
      {showTabBar && (
        <div className="editor-tab-bar" data-testid="editor-tab-bar">
          {openTabs.map((tab) => {
            const isActive = tab.path === activeNotePath
            const isPreview = tab.path === previewTabPath
            const isTabDirty = isActive && isDirty
            return (
              <div
                key={tab.path}
                className="editor-file-tab"
                data-active={isActive ? 'true' : 'false'}
                data-preview={isPreview ? 'true' : undefined}
                data-dirty={isTabDirty ? 'true' : undefined}
                onClick={() => switchTab(tab.path)}
                onDoubleClick={() => {
                  if (isPreview) pinPreviewTab()
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault()
                    closeTab(tab.path)
                  }
                }}
                onMouseDown={(e) => {
                  // Suppress middle-click auto-scroll on the tab body
                  if (e.button === 1) e.preventDefault()
                }}
              >
                <span
                  className="editor-file-tab__title"
                  style={isPreview ? { fontStyle: 'italic' } : undefined}
                >
                  {tab.title}
                </span>
                <span className="editor-file-tab__indicator">
                  <span className="editor-file-tab__dirty-dot" aria-hidden="true" />
                  <button
                    type="button"
                    className="editor-file-tab__close"
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(tab.path)
                    }}
                    aria-label={
                      isTabDirty ? `Close ${tab.title} (unsaved changes)` : `Close ${tab.title}`
                    }
                  >
                    <svg
                      width={9}
                      height={9}
                      viewBox="0 0 9 9"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    >
                      <line x1="2" y1="2" x2="7" y2="7" />
                      <line x1="7" y1="2" x2="2" y2="7" />
                    </svg>
                  </button>
                </span>
              </div>
            )
          })}

          {/* New file button: inline after last tab */}
          <button
            type="button"
            className="editor-tab-bar__btn editor-tab-bar__add"
            onClick={handleNewFile}
            aria-label="New file"
          >
            <svg
              width={12}
              height={12}
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <line x1="6" y1="2" x2="6" y2="10" />
              <line x1="2" y1="6" x2="10" y2="6" />
            </svg>
          </button>

          <div
            className="editor-tab-bar__drag-spacer"
            data-testid="editor-tab-bar-drag-spacer"
            aria-hidden="true"
          />

          {/* Close all pinned right — text button to disambiguate from the macOS
              traffic-light close control. See F-editor-04. */}
          <div className="editor-tab-bar__actions">
            <button
              type="button"
              className="editor-tab-bar__close-all"
              onClick={handleCloseAll}
              aria-label="Close all tabs"
              title="Close all tabs"
            >
              Close all
            </button>
          </div>
        </div>
      )}
      <div className="editor-tab-content">
        <EditorPanel onNavigate={onNavigate} />
      </div>
    </div>
  )
}
