import { useMemo, useState } from 'react'
import { Modal } from '../../components/overlay/Modal'

type Mode = 'new' | 'append'

interface SaveNewParams {
  readonly folder: string
  readonly filename: string
}

interface SaveTextCardDialogProps {
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
    <Modal
      open
      onClose={onClose}
      ariaLabelledBy="save-text-card-title"
      panelClassName="te-savecard-panel"
    >
      <h2 id="save-text-card-title" className="te-savecard-title">
        Save text card
      </h2>
      <div className="te-savecard-modes">
        <label className="te-savecard-mode-option">
          <input
            type="radio"
            name="save-mode"
            checked={mode === 'new'}
            onChange={() => setMode('new')}
          />
          New file
        </label>
        <label className="te-savecard-mode-option">
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
          <div className="te-savecard-field-label">Folder</div>
          <div className="te-savecard-list te-savecard-list--folders">
            {folders.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFolder(f)}
                className="te-savecard-option"
                data-selected={f === folder}
              >
                {f || '/'}
              </button>
            ))}
          </div>
          <div className="te-savecard-field-label">Filename</div>
          <input
            type="text"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
            className="te-savecard-input"
          />
          {collisionWarning && (
            <div className="te-savecard-warning">
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
            className="te-savecard-input"
          />
          <div className="te-savecard-list te-savecard-list--files">
            {filteredFiles.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setSelectedFile(f)}
                className="te-savecard-option"
                data-selected={f === selectedFile}
              >
                {f}
              </button>
            ))}
            {filteredFiles.length === 0 && <div className="te-savecard-empty">No matches</div>}
          </div>
        </>
      )}

      <div className="te-savecard-footer">
        <button type="button" onClick={onClose} className="te-savecard-cancel">
          Cancel
        </button>
        <button type="button" onClick={handleSave} disabled={!canSave} className="te-savecard-save">
          Save
        </button>
      </div>
    </Modal>
  )
}
