import { useEffect, useState } from 'react'
import { useVaultStore } from '../../store/vault-store'
import { colors } from '../../design/tokens'

interface SkillEntry {
  name: string
  description: string
  path: string
}

function parseSkillDescription(content: string): string {
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#') || trimmed === '---') {
      continue
    }
    return trimmed.slice(0, 120)
  }
  return 'No description'
}

function EmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center"
      style={{ color: colors.text.muted }}
    >
      <span style={{ fontSize: '13px' }}>No skills found</span>
      <span style={{ fontSize: '11px', color: colors.text.muted }}>
        Add .md files to .claude/commands/ in your vault
      </span>
    </div>
  )
}

function SkillCard({ skill, onRun }: { skill: SkillEntry; onRun: (skill: SkillEntry) => void }) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border-b cursor-default"
      style={{
        borderColor: colors.border.default,
        backgroundColor: hovered ? colors.bg.elevated : 'transparent',
        transition: '150ms ease-out'
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex-1 min-w-0">
        <div
          className="truncate"
          style={{ fontSize: '13px', color: colors.text.primary, fontWeight: 500 }}
        >
          {skill.name}
        </div>
        <div className="truncate mt-0.5" style={{ fontSize: '11px', color: colors.text.secondary }}>
          {skill.description}
        </div>
      </div>
      {hovered && (
        <button
          onClick={() => onRun(skill)}
          className="shrink-0 px-2 py-0.5 rounded text-xs cursor-pointer"
          style={{
            backgroundColor: colors.accent.muted,
            color: colors.accent.default,
            border: `1px solid ${colors.accent.default}`,
            transition: '150ms ease-out'
          }}
        >
          Run
        </button>
      )}
    </div>
  )
}

export function SkillsPanel() {
  const vaultPath = useVaultStore((s) => s.vaultPath)
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!vaultPath) return

    let cancelled = false
    const commandsDir = `${vaultPath}/.claude/commands`

    async function load() {
      setLoading(true)
      try {
        const paths = await window.api.vault.listCommands(commandsDir)
        const entries: SkillEntry[] = []

        for (const filePath of paths) {
          if (cancelled) return
          try {
            const content = await window.api.vault.readFile(filePath)
            const filename = filePath.split('/').pop() ?? filePath
            const name = filename.replace(/\.md$/, '')
            const description = parseSkillDescription(content)
            entries.push({ name, description, path: filePath })
          } catch {
            // skip unreadable files
          }
        }

        if (!cancelled) {
          const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name))
          setSkills(sorted)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [vaultPath])

  function handleRun(skill: SkillEntry) {
    window.dispatchEvent(
      new CustomEvent('run-skill', { detail: { command: skill.name, path: skill.path } })
    )
  }

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: colors.text.muted, fontSize: '12px' }}
      >
        Loading skills...
      </div>
    )
  }

  if (skills.length === 0) {
    return <EmptyState />
  }

  return (
    <div
      className="h-full flex flex-col overflow-y-auto"
      style={{ backgroundColor: colors.bg.base }}
    >
      <div
        className="px-4 py-2 border-b text-xs shrink-0"
        style={{ borderColor: colors.border.default, color: colors.text.muted }}
      >
        {skills.length} skill{skills.length !== 1 ? 's' : ''}
      </div>
      <div className="flex-1 overflow-y-auto">
        {skills.map((skill) => (
          <SkillCard key={skill.path} skill={skill} onRun={handleRun} />
        ))}
      </div>
    </div>
  )
}
