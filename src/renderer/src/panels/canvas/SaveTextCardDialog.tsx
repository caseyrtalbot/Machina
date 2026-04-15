import { useMemo, useState } from 'react'
import { colors } from '../../design/tokens'

type Mode = 'new' | 'append'

export interface SaveNewParams {
  readonly folder: string
  readonly filename: string
}

export interface SaveTextCardDialogProps {
  readonly initialFilename: string
  readonly folders: readonly string[]
  readonly files: readonly string[]
  readonly onClose: () => void
  readonly onSaveNew: (params: SaveNewParams) => void
  readonly onSaveAppend: (relativeFilePath: string) => void
}

export function SaveTextCardDialog({
  initialFilename,
  folders,
  files,
  onClose,
  onSaveNew,
  onSaveAppend
}: SaveTextCardDialogProps) {
  const [mode, setMode] = useState<Mode>('new')
  const [filename, setFilename] = useState(initialFilename)
  const [folder, setFolder] = useState<string>(folders[0] ?? '')
  const [search, setSearch] = useState('')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const filteredFiles = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return files
    return files.filter((f) => f.toLowerCase().includes(q))
  }, [files, search])

  const trimmedFilename = filename.trim()
  const collisionWarning = useMemo(() => {
    if (mode !== 'new' || !trimmedFilename) return null
    const candidate = trimmedFilename.endsWith('.md') ? trimmedFilename : `${trimmedFilename}.md`
    return files.some((f) => f === `${folder}/${candidate}`)
      ? `A file named "${candidate}" already exists in ${folder}.`
      : null
  }, [mode, trimmedFilename, files, folder])

  const canSave =
    mode === 'new' ? trimmedFilename.length > 0 && !trimmedFilename.includes('/') : !!selectedFile

  function handleSave() {
    if (!canSave) return
    if (mode === 'new') onSaveNew({ folder, filename: trimmedFilename })
    else onSaveAppend(selectedFile!)
  }

  return (
    <div
      role="dialog"
      aria-label="Save text card to vault"
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="border p-4 w-[480px] max-h-[70vh] flex flex-col gap-3"
        style={{
          backgroundColor: colors.bg.elevated,
          borderColor: colors.border.default,
          borderRadius: 10,
          color: colors.text.primary
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="save-mode"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
            />
            New file
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="save-mode"
              checked={mode === 'append'}
              onChange={() => setMode('append')}
            />
            Append to existing
          </label>
        </div>

        {mode === 'new' ? (
          <>
            <div className="text-xs" style={{ color: colors.text.secondary }}>
              Folder
            </div>
            <div
              className="border overflow-auto"
              style={{ borderColor: colors.border.subtle, borderRadius: 6, maxHeight: 180 }}
            >
              {folders.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFolder(f)}
                  className="w-full text-left px-2 py-1 text-xs"
                  style={{
                    backgroundColor: f === folder ? colors.accent.muted : 'transparent'
                  }}
                >
                  {f || '/'}
                </button>
              ))}
            </div>
            <div className="text-xs" style={{ color: colors.text.secondary }}>
              Filename
            </div>
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="px-2 py-1 text-sm bg-transparent border outline-none"
              style={{ borderColor: colors.border.default, borderRadius: 4 }}
            />
            {collisionWarning && (
              <div className="text-xs" style={{ color: '#c08a00' }}>
                {collisionWarning} A unique suffix will be added on save.
              </div>
            )}
          </>
        ) : (
          <>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vault files..."
              className="px-2 py-1 text-sm bg-transparent border outline-none"
              style={{ borderColor: colors.border.default, borderRadius: 4 }}
            />
            <div
              className="border overflow-auto"
              style={{ borderColor: colors.border.subtle, borderRadius: 6, maxHeight: 240 }}
            >
              {filteredFiles.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setSelectedFile(f)}
                  className="w-full text-left px-2 py-1 text-xs"
                  style={{
                    backgroundColor: f === selectedFile ? colors.accent.muted : 'transparent'
                  }}
                >
                  {f}
                </button>
              ))}
              {filteredFiles.length === 0 && (
                <div className="px-2 py-2 text-xs" style={{ color: colors.text.secondary }}>
                  No matches
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-xs"
            style={{ color: colors.text.secondary }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="px-3 py-1 text-xs"
            style={{
              backgroundColor: canSave ? colors.accent.default : colors.bg.surface,
              color: canSave ? '#fff' : colors.text.muted,
              borderRadius: 4,
              opacity: canSave ? 1 : 0.5,
              cursor: canSave ? 'pointer' : 'default'
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

export default SaveTextCardDialog
