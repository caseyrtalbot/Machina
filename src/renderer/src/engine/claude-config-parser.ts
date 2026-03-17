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

function inferMemoryType(filePath: string): string {
  const stem = filenameStem(filePath).toLowerCase()
  if (stem.startsWith('feedback-') || stem.startsWith('feedback_')) return 'feedback'
  if (stem.startsWith('project-') || stem.startsWith('project_')) return 'project'
  if (stem.startsWith('user-') || stem.startsWith('user_')) return 'user'
  if (stem.startsWith('reference-') || stem.startsWith('reference_')) return 'reference'
  return 'unknown'
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

/**
 * Merge two settings objects for visualization (union of envVars, plugins, permissions).
 * The `override` settings take precedence for rawJson, but lists are combined.
 */
export function mergeClaudeSettings(
  base: ClaudeSettings,
  override: ClaudeSettings
): ClaudeSettings {
  const envVars = [...new Set([...base.envVars, ...override.envVars])]
  const plugins = [...new Set([...base.plugins, ...override.plugins])]

  const baseAllow = Array.isArray((base.permissions as Record<string, unknown>).allow)
    ? ((base.permissions as Record<string, unknown>).allow as string[])
    : []
  const overrideAllow = Array.isArray((override.permissions as Record<string, unknown>).allow)
    ? ((override.permissions as Record<string, unknown>).allow as string[])
    : []
  const mergedAllow = [...new Set([...baseAllow, ...overrideAllow])]

  return {
    permissions: { ...base.permissions, ...override.permissions, allow: mergedAllow },
    envVars,
    plugins,
    rawJson: { ...base.rawJson, ...override.rawJson },
    allowCount: mergedAllow.length
  }
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
  const trimmed = content.trim()
  let description = ''

  // Try frontmatter first (some commands have it)
  try {
    const parsed = matter(trimmed)
    if (parsed.data?.description) {
      description = String(parsed.data.description)
    }
  } catch {
    // Frontmatter parse failed
  }

  // Fall back to H1 heading if no description from frontmatter
  if (!description) {
    const firstLine = trimmed.split('\n')[0]
    if (firstLine?.startsWith('#')) {
      description = firstLine.replace(/^#+\s*/, '')
    }
  }

  // Final fallback: first non-empty, non-heading line as description
  if (!description) {
    const lines = trimmed.split('\n')
    const firstContent = lines.find((l) => l.trim() && !l.startsWith('#') && !l.startsWith('---'))
    if (firstContent) {
      description = truncate(firstContent.trim(), 120)
    }
  }

  // Body preview: strip frontmatter if present, take first meaningful lines
  let bodyPreview = trimmed
  const fmEnd = trimmed.indexOf('---', trimmed.indexOf('---') + 3)
  if (trimmed.startsWith('---') && fmEnd > 0) {
    bodyPreview = trimmed.slice(fmEnd + 3).trim()
  }

  return {
    name: filenameStem(filePath),
    description,
    content: truncate(bodyPreview, 200),
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
    memoryType: data?.type ? String(data.type) : inferMemoryType(filePath),
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
 * Encode a project path the way Claude Code does: /Users/casey → -Users-casey
 */
function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/\//g, '-')
}

/**
 * Load project-scoped rules and memory from ~/.claude/projects/{encoded}/
 * and from the project's own CLAUDE.md and .claude/ directory.
 */
async function loadProjectConfig(
  basePath: string,
  projectPath: string
): Promise<{ rules: ClaudeRule[]; commands: ClaudeCommand[]; memories: ClaudeMemory[] }> {
  const rules: ClaudeRule[] = []
  const commands: ClaudeCommand[] = []
  const memories: ClaudeMemory[] = []

  // 1. Project-scoped memory from ~/.claude/projects/{encoded}/memory/
  const encoded = encodeProjectPath(projectPath)
  const projectDir = `${basePath}/projects/${encoded}`

  try {
    const exists = await window.api.fs.fileExists(projectDir)
    if (exists) {
      const projectFiles = await window.api.fs.listAllFiles(projectDir)
      for (const file of projectFiles) {
        if (file.includes('memory/') && file.endsWith('.md') && !file.endsWith('MEMORY.md')) {
          try {
            const content = await window.api.fs.readFile(file)
            memories.push({ ...parseClaudeMemory(content, file), scope: 'project' })
          } catch {
            /* skip */
          }
        }
      }
    }
  } catch {
    /* no project dir */
  }

  // 2. Project-root CLAUDE.md as a rule
  const claudeMdPath = `${projectPath}/CLAUDE.md`
  try {
    const exists = await window.api.fs.fileExists(claudeMdPath)
    if (exists) {
      const content = await window.api.fs.readFile(claudeMdPath)
      rules.push({
        name: 'CLAUDE.md',
        category: 'project',
        content: truncate(content.trim(), 200),
        filePath: claudeMdPath,
        scope: 'project'
      })
    }
  } catch {
    /* no CLAUDE.md */
  }

  // 3. Project-scoped rules from {project}/.claude/rules/
  const projectClaudeDir = `${projectPath}/.claude`
  try {
    const exists = await window.api.fs.fileExists(projectClaudeDir)
    if (exists) {
      const projFiles = await window.api.fs.listAllFiles(projectClaudeDir)
      for (const file of projFiles) {
        const rel = file.slice(projectClaudeDir.length + 1)
        if (rel.startsWith('rules/') && rel.endsWith('.md')) {
          try {
            const content = await window.api.fs.readFile(file)
            rules.push({ ...parseClaudeRule(content, file), scope: 'project' })
          } catch {
            /* skip */
          }
        } else if (rel.startsWith('commands/') && rel.endsWith('.md')) {
          try {
            const content = await window.api.fs.readFile(file)
            commands.push({ ...parseClaudeCommand(content, file), scope: 'project' })
          } catch {
            /* skip */
          }
        }
      }
    }
  } catch {
    /* no project .claude dir */
  }

  return { rules, commands, memories }
}

/**
 * Load and parse the full Claude configuration from a base path.
 * Optionally merges project-scoped config when projectPath is provided.
 */
export async function loadClaudeConfig(
  basePath: string,
  projectPath?: string
): Promise<ClaudeConfig> {
  // Also check for .claude.json in parent directory
  const parentSettingsPath = basePath.replace(/\/.claude$/, '/.claude.json')

  const allFiles = await window.api.fs.listAllFiles(basePath)

  const { settingsFiles, agentFiles, skillDirs, ruleFiles, commandFiles, teamFiles, memoryFiles } =
    categorizeFiles(allFiles, basePath)

  // Parse settings: read both files and merge for a complete visualization
  let settings: ClaudeSettings | null = null
  const baseSettingsPath = settingsFiles.find((f) => f.endsWith('settings.json'))
  const localSettingsPath = settingsFiles.find((f) => f.endsWith('settings.local.json'))

  let baseSettings: ClaudeSettings | null = null
  let localSettings: ClaudeSettings | null = null

  if (baseSettingsPath) {
    try {
      baseSettings = parseClaudeSettings(await window.api.fs.readFile(baseSettingsPath))
    } catch {
      /* unreadable */
    }
  }
  if (localSettingsPath) {
    try {
      localSettings = parseClaudeSettings(await window.api.fs.readFile(localSettingsPath))
    } catch {
      /* unreadable */
    }
  }

  if (baseSettings && localSettings) {
    settings = mergeClaudeSettings(baseSettings, localSettings)
  } else if (localSettings) {
    settings = localSettings
  } else if (baseSettings) {
    settings = baseSettings
  } else {
    // Fall back to .claude.json in parent directory
    try {
      const exists = await window.api.fs.fileExists(parentSettingsPath)
      if (exists) {
        settings = parseClaudeSettings(await window.api.fs.readFile(parentSettingsPath))
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
      agents.push({ ...parseClaudeAgent(content, file), scope: 'global' as const })
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
        skills.push({ ...parseClaudeSkill(content, skillMd, files), scope: 'global' as const })
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
      rules.push({ ...parseClaudeRule(content, file), scope: 'global' as const })
    } catch {
      // Skip unreadable rules
    }
  }

  // Parse commands
  const commands: ClaudeCommand[] = []
  for (const file of commandFiles) {
    try {
      const content = await window.api.fs.readFile(file)
      commands.push({ ...parseClaudeCommand(content, file), scope: 'global' as const })
    } catch {
      // Skip unreadable commands
    }
  }

  // Parse teams
  const teams: ClaudeTeam[] = []
  for (const file of teamFiles) {
    try {
      const content = await window.api.fs.readFile(file)
      teams.push({ ...parseClaudeTeam(content, file), scope: 'global' as const })
    } catch {
      // Skip unreadable teams
    }
  }

  // Parse memories
  const memories: ClaudeMemory[] = []
  for (const file of memoryFiles) {
    try {
      const content = await window.api.fs.readFile(file)
      memories.push({ ...parseClaudeMemory(content, file), scope: 'global' as const })
    } catch {
      // Skip unreadable memories
    }
  }

  // Merge project-scoped config if a project path was provided
  if (projectPath) {
    const project = await loadProjectConfig(basePath, projectPath)
    rules.push(...project.rules)
    commands.push(...project.commands)
    memories.push(...project.memories)
  }

  return {
    basePath,
    projectPath: projectPath ?? null,
    settings,
    agents,
    skills,
    rules,
    commands,
    teams,
    memories
  }
}
