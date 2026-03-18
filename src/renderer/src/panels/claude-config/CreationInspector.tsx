import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { markdown } from '@codemirror/lang-markdown'
import { useCodeMirrorEditor } from '../canvas/shared/use-codemirror'
import { colors, typography } from '../../design/tokens'
import {
  slugify,
  generateCommandTemplate,
  generateAgentTemplate,
  generateSkillTemplate,
  generateMemoryTemplate,
  generateRuleTemplate,
  getTargetPath,
  AVAILABLE_TOOLS,
  type ConfigType
} from './creation-templates'

const TYPE_COLORS: Record<string, string> = {
  command: '#34d399',
  agent: '#a78bfa',
  skill: '#22d3ee',
  memory: '#fb923c',
  rule: '#94a3b8'
}

const TYPE_LABELS: Record<string, string> = {
  command: 'Command',
  agent: 'Agent',
  skill: 'Skill',
  memory: 'Memory',
  rule: 'Rule'
}

interface CreationInspectorProps {
  readonly configType: string
  readonly configPath: string
  readonly projectPath: string | null
  readonly onCreated: (filePath: string, title: string) => void
  readonly onClose: () => void
}

export function CreationInspector({
  configType,
  configPath,
  projectPath,
  onCreated,
  onClose
}: CreationInspectorProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState('sonnet')
  const [tools, setTools] = useState<string[]>(['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'])
  const [memoryType, setMemoryType] = useState('feedback')
  const [category, setCategory] = useState('common')
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)

  const slug = slugify(name)
  const accentColor = TYPE_COLORS[configType] ?? '#94a3b8'

  const templateContent = useMemo(() => {
    if (!slug) return ''
    switch (configType) {
      case 'command':
        return generateCommandTemplate(slug)
      case 'agent':
        return generateAgentTemplate(slug, description, model, tools)
      case 'skill':
        return generateSkillTemplate(slug, description)
      case 'memory':
        return generateMemoryTemplate(`${memoryType}-${slug}`, description, memoryType)
      case 'rule':
        return generateRuleTemplate(slug)
      default:
        return ''
    }
  }, [configType, slug, description, model, tools, memoryType])

  const targetPath = useMemo(() => {
    if (!slug) return ''
    return getTargetPath(configType as ConfigType, configPath, name, {
      category,
      memoryType,
      projectPath
    })
  }, [configType, configPath, name, category, memoryType, projectPath, slug])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const toggleTool = useCallback((tool: string) => {
    setTools((prev) => (prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]))
  }, [])

  // Tracks user edits in the editor. Reset when editor remounts (via key prop).
  // Form field changes regenerate the template and remount the editor (one-way sync).
  const editorContentRef = useRef(templateContent)

  const handleEditorChange = useCallback((content: string) => {
    editorContentRef.current = content
  }, [])

  const handleCreate = useCallback(async () => {
    if (!slug) {
      setError('Name is required')
      return
    }
    if (configType === 'memory' && !projectPath) {
      setError('Memory requires an active project')
      return
    }
    setError(null)
    setIsCreating(true)

    try {
      const exists = await window.api.fs.fileExists(targetPath)
      if (exists) {
        setError(`File already exists: ${targetPath.split('/').pop()}`)
        setIsCreating(false)
        return
      }

      // Ensure parent directory exists for all types (recursive mkdir is safe for existing dirs)
      const dirPath = targetPath.split('/').slice(0, -1).join('/')
      await window.api.fs.mkdir(dirPath)

      const content = editorContentRef.current || templateContent
      await window.api.fs.writeFile(targetPath, content)
      onCreated(targetPath, slug)
    } catch (err) {
      setError(`Failed to create: ${String(err)}`)
    }
    setIsCreating(false)
  }, [slug, targetPath, configType, templateContent, onCreated])

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: colors.bg.base }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{
          backgroundColor: colors.bg.elevated,
          borderBottom: `1px solid ${colors.border.default}`
        }}
      >
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium" style={{ color: colors.text.primary }}>
            New {TYPE_LABELS[configType] ?? configType}
          </span>
          {targetPath && (
            <span
              className="text-xs truncate"
              style={{ color: colors.text.muted, fontFamily: typography.fontFamily.mono }}
            >
              {targetPath.split('.claude/').pop()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1 rounded"
            style={{ color: colors.text.secondary, border: `1px solid ${colors.border.default}` }}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!slug || isCreating}
            className="text-xs px-3 py-1 rounded font-medium"
            style={{
              backgroundColor: slug ? accentColor : colors.bg.elevated,
              color: slug ? '#0f172a' : colors.text.muted,
              opacity: isCreating ? 0.6 : 1
            }}
          >
            {isCreating ? 'Creating...' : `Create ${TYPE_LABELS[configType] ?? ''}`}
          </button>
        </div>
      </div>

      {/* Form fields */}
      <div
        className="px-3 py-3 space-y-3 shrink-0 overflow-y-auto"
        style={{ borderBottom: `1px solid ${colors.border.default}`, maxHeight: '50%' }}
      >
        {/* Name field */}
        <div>
          <label
            className="block mb-1"
            style={{ ...typography.metadata, color: colors.text.muted }}
          >
            NAME
          </label>
          <div className="flex items-center gap-1">
            {configType === 'command' && (
              <span
                style={{
                  color: accentColor,
                  fontFamily: typography.fontFamily.mono,
                  fontSize: 14
                }}
              >
                /
              </span>
            )}
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              placeholder={configType === 'command' ? 'deploy-check' : `my-${configType}`}
              autoFocus
              className="flex-1 px-2 py-1.5 rounded text-sm"
              style={{
                backgroundColor: colors.bg.elevated,
                border: `1px solid ${colors.border.default}`,
                color: colors.text.primary,
                fontFamily: typography.fontFamily.mono,
                outline: 'none'
              }}
            />
          </div>
          {slug && slug !== name && (
            <span
              className="text-xs mt-0.5 block"
              style={{ color: colors.text.muted, fontFamily: typography.fontFamily.mono }}
            >
              {slug}.md
            </span>
          )}
        </div>

        {/* Description (agents, skills, memory) */}
        {(configType === 'agent' || configType === 'skill' || configType === 'memory') && (
          <div>
            <label
              className="block mb-1"
              style={{ ...typography.metadata, color: colors.text.muted }}
            >
              DESCRIPTION
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One-line description"
              className="w-full px-2 py-1.5 rounded text-sm"
              style={{
                backgroundColor: colors.bg.elevated,
                border: `1px solid ${colors.border.default}`,
                color: colors.text.primary,
                outline: 'none'
              }}
            />
          </div>
        )}

        {/* Model toggle (agents only) */}
        {configType === 'agent' && (
          <div>
            <label
              className="block mb-1"
              style={{ ...typography.metadata, color: colors.text.muted }}
            >
              MODEL
            </label>
            <div className="flex gap-2">
              {['opus', 'sonnet', 'haiku'].map((m) => (
                <button
                  key={m}
                  onClick={() => setModel(m)}
                  className="px-3 py-1 rounded text-xs font-medium"
                  style={{
                    backgroundColor: model === m ? accentColor + '30' : colors.bg.elevated,
                    border: `1px solid ${model === m ? accentColor : colors.border.default}`,
                    color: model === m ? accentColor : colors.text.secondary
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tool chips (agents only) */}
        {configType === 'agent' && (
          <div>
            <label
              className="block mb-1"
              style={{ ...typography.metadata, color: colors.text.muted }}
            >
              TOOLS
            </label>
            <div className="flex flex-wrap gap-1.5">
              {AVAILABLE_TOOLS.map((tool) => {
                const active = tools.includes(tool)
                return (
                  <button
                    key={tool}
                    onClick={() => toggleTool(tool)}
                    className="px-2 py-0.5 rounded text-xs"
                    style={{
                      backgroundColor: active ? accentColor + '20' : colors.bg.elevated,
                      border: `1px solid ${active ? accentColor + '44' : colors.border.default}`,
                      color: active ? '#c4b5fd' : colors.text.muted,
                      fontFamily: typography.fontFamily.mono
                    }}
                  >
                    {tool}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Memory type */}
        {configType === 'memory' && (
          <div>
            <label
              className="block mb-1"
              style={{ ...typography.metadata, color: colors.text.muted }}
            >
              TYPE
            </label>
            <div className="flex gap-2">
              {['feedback', 'project', 'user', 'reference'].map((t) => (
                <button
                  key={t}
                  onClick={() => setMemoryType(t)}
                  className="px-2.5 py-1 rounded text-xs font-medium"
                  style={{
                    backgroundColor: memoryType === t ? accentColor + '30' : colors.bg.elevated,
                    border: `1px solid ${memoryType === t ? accentColor : colors.border.default}`,
                    color: memoryType === t ? accentColor : colors.text.secondary
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Category (rules only) */}
        {configType === 'rule' && (
          <div>
            <label
              className="block mb-1"
              style={{ ...typography.metadata, color: colors.text.muted }}
            >
              CATEGORY
            </label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="common"
              className="w-full px-2 py-1.5 rounded text-sm"
              style={{
                backgroundColor: colors.bg.elevated,
                border: `1px solid ${colors.border.default}`,
                color: colors.text.primary,
                fontFamily: typography.fontFamily.mono,
                outline: 'none'
              }}
            />
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-xs" style={{ color: '#ef4444' }}>
            {error}
          </p>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {templateContent ? (
          <CreationEditor
            key={`${configType}-${slug}-${model}-${tools.join(',')}-${memoryType}`}
            content={templateContent}
            onChange={handleEditorChange}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <span className="text-xs" style={{ color: colors.text.muted }}>
              Enter a name to see the template preview
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function CreationEditor({
  content,
  onChange
}: {
  readonly content: string
  readonly onChange: (content: string) => void
}) {
  const { containerRef } = useCodeMirrorEditor({
    initialContent: content,
    language: markdown(),
    onChange
  })

  return <div ref={containerRef} className="h-full" />
}
