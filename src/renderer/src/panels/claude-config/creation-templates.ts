export type ConfigType = 'command' | 'agent' | 'skill' | 'memory' | 'rule'

export const AVAILABLE_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Grep',
  'Glob',
  'Agent',
  'WebFetch',
  'WebSearch',
  'NotebookEdit'
] as const

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

export function generateCommandTemplate(name: string): string {
  return `---\ndescription: Describe what /${name} does\n---\n\nInstructions for Claude when /${name} is invoked.\n`
}

export function generateAgentTemplate(
  name: string,
  description: string,
  model: string,
  tools: readonly string[]
): string {
  const toolsYaml = tools.map((t) => `  - ${t}`).join('\n')
  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `model: ${model}`,
    'tools:',
    toolsYaml,
    '---',
    '',
    `You are ${description ? description.toLowerCase() : `the ${name} agent`}.`,
    ''
  ].join('\n')
}

export function generateSkillTemplate(name: string, description: string): string {
  const titleCase = name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    `# ${titleCase}`,
    '',
    'Skill instructions go here.',
    ''
  ].join('\n')
}

export function generateMemoryTemplate(
  name: string,
  description: string,
  memoryType: string
): string {
  const guidance: Record<string, string> = {
    feedback: 'Lead with the rule itself, then a **Why:** line and **How to apply:** line.',
    project: 'Lead with the fact or decision, then **Why:** and **How to apply:** lines.',
    user: "Information about the user's role, goals, or preferences.",
    reference: 'Pointer to where information can be found in external systems.'
  }
  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `type: ${memoryType}`,
    '---',
    '',
    guidance[memoryType] ?? 'Memory content goes here.',
    ''
  ].join('\n')
}

export function generateRuleTemplate(name: string): string {
  const titleCase = name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  return `# ${titleCase}\n\nRule content goes here.\n`
}

export function getTargetPath(
  configType: ConfigType,
  basePath: string,
  name: string,
  options?: { category?: string; memoryType?: string; projectPath?: string | null }
): string {
  const slug = slugify(name)
  switch (configType) {
    case 'command':
      return `${basePath}/commands/${slug}.md`
    case 'agent':
      return `${basePath}/agents/${slug}.md`
    case 'skill':
      return `${basePath}/skills/${slug}/SKILL.md`
    case 'memory': {
      const encoded = (options?.projectPath ?? '').replace(/\//g, '-')
      const prefix = options?.memoryType ?? 'user'
      return `${basePath}/projects/${encoded}/memory/${prefix}-${slug}.md`
    }
    case 'rule': {
      const cat = options?.category ? slugify(options.category) : 'common'
      return `${basePath}/rules/${cat}/${slug}.md`
    }
  }
}
