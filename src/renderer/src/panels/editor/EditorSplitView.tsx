import { useEditorStore, createUntitledNote } from '../../store/editor-store'
import { useVaultStore } from '../../store/vault-store'
import { EditorPanel } from './EditorPanel'
import { TabBar } from '../../components/tabbar/TabBar'

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

  // Keep the bar (and its new-file affordance) visible with 0-1 tabs too —
  // hiding it left new-file unreachable until a second tab existed.
  const showTabBar = openTabs.length > 0 || Boolean(vaultPath)

  const handleNewFile = async () => {
    if (!vaultPath) return
    const { path, title } = await createUntitledNote(vaultPath)
    useEditorStore.getState().openTab(path, title)
  }

  const handleCloseAll = () => {
    const tabs = useEditorStore.getState().openTabs
    for (const tab of tabs) {
      useEditorStore.getState().closeTab(tab.path)
    }
  }

  const items = openTabs.map((tab) => {
    const isTabDirty = tab.path === activeNotePath && isDirty
    return {
      id: tab.path,
      label: tab.title,
      dirty: isTabDirty,
      preview: tab.path === previewTabPath,
      closeLabel: isTabDirty ? `Close ${tab.title} (unsaved changes)` : `Close ${tab.title}`
    }
  })

  // New file button: inline after last tab
  const newFileButton = (
    <button
      type="button"
      className="te-tabbar__btn te-tabbar__add"
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
  )

  // Close all pinned right — text button to disambiguate from the macOS
  // traffic-light close control. See F-editor-04.
  const closeAllButton = (
    <button
      type="button"
      className="te-tabbar__text-btn"
      onClick={handleCloseAll}
      aria-label="Close all tabs"
      title="Close all tabs"
    >
      Close all
    </button>
  )

  return (
    <div className="editor-tabbed-container">
      {showTabBar && (
        <TabBar
          variant="chrome"
          items={items}
          activeId={activeNotePath}
          ariaLabel="Open notes"
          testId="editor-tab-bar"
          spacerTestId="editor-tab-bar-drag-spacer"
          onActivate={switchTab}
          onClose={(ids) => {
            for (const id of ids) closeTab(id)
          }}
          onPin={() => pinPreviewTab()}
          trailing={newFileButton}
          actions={closeAllButton}
        />
      )}
      <div className="editor-tab-content">
        <EditorPanel onNavigate={onNavigate} />
      </div>
    </div>
  )
}
