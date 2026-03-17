import matter from 'gray-matter'
import type {
  ClaudeConfig,
  ClaudeSettings,
  ClaudeAgent,
  ClaudeSkill,
  ClaudeRule,
  ClaudeCommand,
  ClaudeTeam,
  ClaudeMemory
} from '@shared/claude-config-types'

function toStringArray(val: unknown): string[] {
  if (!val) return []
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === 'string') return [val]
  return []
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + '...'
}

function filenameStem(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath
  return base.replace(/\.\w+$/, '')
}

function parentDirName(filePath: string): string {
  const parts = filePath.split('/')
  return parts.length >= 2 ? parts[parts.length - 2] : ''
}

export function parseClaudeSettings(json: string): ClaudeSettings {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json) as Record<string, unknown>
  } catch {
    raw = {}
  }

  const permissionsObj = (raw.permissions ?? {}) as Record<string, unknown>
  const allowList = Array.isArray(permissionsObj.allow) ? permissionsObj.allow : []

  // env is a dict {KEY: "value"}, not a string array
  const envObj =
    raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env)
      ? (raw.env as Record<string, string>)
      : {}
  const envVars = Object.keys(envObj)

  // Plugins: enabledPlugins is {pluginId: true/false}, not mcpServers
  const enabledPlugins =
    raw.enabledPlugins && typeof raw.enabledPlugins === 'object'
      ? (raw.enabledPlugins as Record<string, boolean>)
      : {}
  const plugins = Object.keys(enabledPlugins).filter((k) => enabledPlugins[k])

  return {
    permissions: permissionsObj,
    envVars,
    plugins,
    rawJson: raw,
    allowCount: allowList.length
  } as ClaudeSettings
}

export function parseClaudeAgent(content: string, filePath: string): ClaudeAgent {
  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(content)
  } catch {
    return {
      name: filenameStem(filePath),
      description: '',
      model: '',
      tools: [],
      filePath,
      instructionPreview: truncate(content, 120)
    }
  }

  const { data, content: body } = parsed

  return {
    name: data?.name ? String(data.name) : filenameStem(filePath),
    description: data?.description ? String(data.description) : '',
    model: data?.model ? String(data.model) : '',
    tools: toStringArray(data?.tools),
    filePath,
    instructionPreview: truncate(body.trim(), 120)
  }
}

export function parseClaudeSkill(
  content: string,
  filePath: string,
  subFiles: readonly string[]
): ClaudeSkill {
  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(content)
  } catch {
    return {
      name: parentDirName(filePath) || filenameStem(filePath),
      description: '',
      filePath,
      promptFiles: [],
      referenceFiles: []
    }
  }

  const { data } = parsed
  const promptFiles = subFiles.filter((f) => f.includes('/prompts/'))
  const referenceFiles = subFiles.filter((f) => f.includes('/references/'))

  return {
    name: data?.name ? String(data.name) : parentDirName(filePath),
    description: data?.description ? String(data.description) : '',
    filePath,
    promptFiles,
    referenceFiles
  }
}

export function parseClaudeRule(content: string, filePath: string): ClaudeRule {
  const category = parentDirName(filePath)
  return {
    name: filenameStem(filePath),
    category: category || 'global',
    content: truncate(content.trim(), 200),
    filePath
  }
}

export function parseClaudeCommand(content: string, filePath: string): ClaudeCommand {
  let description = ''
  const firstLine = content.trim().split('\n')[0]
  if (firstLine?.startsWith('#')) {
    description = firstLine.replace(/^#+\s*/, '')
  }

  return {
    name: filenameStem(filePath),
    description,
    content: truncate(content.trim(), 200),
    filePath
  }
}

export function parseClaudeTeam(json: string, filePath: string): ClaudeTeam {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json) as Record<string, unknown>
  } catch {
    raw = {}
  }

  // Members can be strings OR objects with a 'name' field
  const rawMembers = Array.isArray(raw.members)
    ? raw.members
    : Array.isArray(raw.agents)
      ? raw.agents
      : []
  const members = rawMembers.map((m: unknown) => {
    if (typeof m === 'string') return m
    if (m && typeof m === 'object' && 'name' in m)
      return String((m as Record<string, unknown>).name)
    if (m && typeof m === 'object' && 'agentId' in m) {
      // Extract name from agentId like "team-lead@db-fix-team"
      const id = String((m as Record<string, unknown>).agentId)
      return id.split('@')[0]
    }
    return String(m)
  })

  const lead = raw.lead ? String(raw.lead) : null
  // Derive team name from directory: /teams/db-fix-team/config.json → db-fix-team
  const dirName = filePath.split('/').slice(-2, -1)[0]

  return {
    name: raw.name ? String(raw.name) : dirName || filenameStem(filePath),
    members,
    lead,
    filePath,
    rawConfig: raw
  }
}

export function parseClaudeMemory(content: string, filePath: string): ClaudeMemory {
  let parsed: matter.GrayMatterFile<string>
  try {
    parsed = matter(content)
  } catch {
    return {
      name: filenameStem(filePath),
      description: '',
      memoryType: 'unknown',
      content: truncate(content.trim(), 200),
      filePath,
      links: []
    }
  }

  const { data, content: body } = parsed

  // Extract markdown links [text](file.md)
  const linkRegex = /\[([^\]]*)\]\(([^)]+\.md)\)/g
  const links: string[] = []
  let match = linkRegex.exec(body)
  while (match) {
    links.push(match[2])
    match = linkRegex.exec(body)
  }

  return {
    name: data?.name ? String(data.name) : filenameStem(filePath),
    description: data?.description ? String(data.description) : '',
    memoryType: data?.type ? String(data.type) : 'unknown',
    content: truncate(body.trim(), 200),
    filePath,
    links
  }
}

/**
 * Categorize files from ~/.claude/ into their respective types based on path.
 */
function categorizeFiles(allFiles: readonly string[], basePath: string) {
  const settingsFiles: string[] = []
  const agentFiles: string[] = []
  const skillDirs = new Map<string, string[]>()
  const ruleFiles: string[] = []
  const commandFiles: string[] = []
  const teamFiles: string[] = []
  const memoryFiles: string[] = []

  const normalBase = basePath.endsWith('/') ? basePath : basePath + '/'

  for (const file of allFiles) {
    const rel = file.startsWith(normalBase) ? file.slice(normalBase.length) : file

    if (rel === 'settings.json' || rel === 'settings.local.json') {
      settingsFiles.push(file)
    } else if (rel.startsWith('agents/') && rel.endsWith('.md')) {
      agentFiles.push(file)
    } else if (rel.startsWith('skills/')) {
      // Group by skill directory
      const parts = rel.slice('skills/'.length).split('/')
      if (parts.length >= 2) {
        const skillName = parts[0]
        const existing = skillDirs.get(skillName) ?? []
        existing.push(file)
        skillDirs.set(skillName, existing)
      }
    } else if (rel.startsWith('rules/') && rel.endsWith('.md')) {
      ruleFiles.push(file)
    } else if (rel.startsWith('commands/') && rel.endsWith('.md')) {
      commandFiles.push(file)
    } else if (rel.startsWith('teams/') && rel.endsWith('/config.json')) {
      teamFiles.push(file)
    } else if (rel.includes('memory/') && rel.endsWith('.md')) {
      // Memory files live in projects/*/memory/*.md
      const stem = filenameStem(file)
      if (stem !== 'MEMORY') {
        memoryFiles.push(file)
      }
    }
  }

  return { settingsFiles, agentFiles, skillDirs, ruleFiles, commandFiles, teamFiles, memoryFiles }
}

/**
 * Load and parse the full Claude configuration from a base path.
 * Uses IPC to read files from the main process.
 */
export async function loadClaudeConfig(basePath: string): Promise<ClaudeConfig> {
  // Also check for .claude.json in parent directory
  const parentSettingsPath = basePath.replace(/\/.claude$/, '/.claude.json')

  const allFiles = await window.api.fs.listAllFiles(basePath)

  const { settingsFiles, agentFiles, skillDirs, ruleFiles, commandFiles, teamFiles, memoryFiles } =
    categorizeFiles(allFiles, basePath)

  // Parse settings (prefer settings.local.json, fall back to settings.json, then .claude.json)
  let settings: ClaudeSettings | null = null
  const settingsPath =
    settingsFiles.find((f) => f.endsWith('settings.local.json')) ??
    settingsFiles.find((f) => f.endsWith('settings.json'))

  if (settingsPath) {
    try {
      const content = await window.api.fs.readFile(settingsPath)
      settings = parseClaudeSettings(content)
    } catch {
      // Settings file unreadable
    }
  } else {
    try {
      const exists = await window.api.fs.fileExists(parentSettingsPath)
      if (exists) {
        const content = await window.api.fs.readFile(parentSettingsPath)
        settings = parseClaudeSettings(content)
      }
    } catch {
      // No settings found
    }
  }

  // Parse agents
  const agents: ClaudeAgent[] = []
  for (const file of agentFiles) {
    try {
      const content = await window.api.fs.readFile(file)
      agents.push(parseClaudeAgent(content, file))
    } catch {
      // Skip unreadable agents
    }
  }

  // Parse skills
  const skills: ClaudeSkill[] = []
  for (const [, files] of skillDirs) {
    const skillMd = files.find((f) => f.endsWith('SKILL.md'))
    if (skillMd) {
      try {
        const content = await window.api.fs.readFile(skillMd)
        skills.push(parseClaudeSkill(content, skillMd, files))
      } catch {
        // Skip unreadable skills
      }
    }
  }

  // Parse rules
  const rules: ClaudeRule[] = []
  for (const file of ruleFiles) {
    try {
      const content = await window.api.fs.readFile(file)
      rules.push(parseClaudeRule(content, file))
    } catch {
      // Skip unreadable rules
    }
  }

  // Parse commands
  const commands: ClaudeCommand[] = []
  for (const file of commandFiles) {
    try {
      const content = await window.api.fs.readFile(file)
      commands.push(parseClaudeCommand(content, file))
    } catch {
      // Skip unreadable commands
    }
  }

  // Parse teams
  const teams: ClaudeTeam[] = []
  for (const file of teamFiles) {
    try {
      const content = await window.api.fs.readFile(file)
      teams.push(parseClaudeTeam(content, file))
    } catch {
      // Skip unreadable teams
    }
  }

  // Parse memories
  const memories: ClaudeMemory[] = []
  for (const file of memoryFiles) {
    try {
      const content = await window.api.fs.readFile(file)
      memories.push(parseClaudeMemory(content, file))
    } catch {
      // Skip unreadable memories
    }
  }

  return {
    basePath,
    settings,
    agents,
    skills,
    rules,
    commands,
    teams,
    memories
  }
}
