import { useEditorStore } from '../../store/editor-store'
import { useVaultStore } from '../../store/vault-store'
import { EditorPanel } from './EditorPanel'

interface EditorSplitViewProps {
  onNavigate: (id: string) => void
}

export function EditorSplitView({ onNavigate }: EditorSplitViewProps) {
  const openTabs = useEditorStore((s) => s.openTabs)
  const activeNotePath = useEditorStore((s) => s.activeNotePath)
  const switchTab = useEditorStore((s) => s.switchTab)
  const closeTab = useEditorStore((s) => s.closeTab)
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
            return (
              <div
                key={tab.path}
                className="editor-file-tab"
                data-active={isActive ? 'true' : 'false'}
                onClick={() => switchTab(tab.path)}
              >
                <span className="editor-file-tab__title">{tab.title}</span>
                <button
                  className="editor-file-tab__close"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTab(tab.path)
                  }}
                  aria-label={`Close ${tab.title}`}
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
              </div>
            )
          })}

          {/* New file button: inline after last tab */}
          <button
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

          {/* Close all pinned right */}
          <div className="editor-tab-bar__actions">
            <button
              className="editor-tab-bar__btn"
              onClick={handleCloseAll}
              aria-label="Close all tabs"
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
                <line x1="3" y1="3" x2="9" y2="9" />
                <line x1="9" y1="3" x2="3" y2="9" />
              </svg>
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
