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
  return [
    '---',
    `description: Describe what /${name} does in one sentence`,
    '---',
    '',
    `# /${name}`,
    '',
    '<!-- Command instructions tell Claude what to do when a user types /${name}. -->',
    '<!-- Best practices: -->',
    '<!--   - Start with a clear action verb (Analyze, Generate, Review, Fix) -->',
    '<!--   - Specify the output format if needed (markdown, JSON, code) -->',
    '<!--   - Include constraints (scope, length, style) -->',
    '<!--   - Reference specific tools or skills by name if the command should use them -->',
    '',
    `Analyze the current project and provide a concise summary of [what /${name} should do].`,
    '',
    '## Steps',
    '',
    '1. [First action Claude should take]',
    '2. [Second action]',
    '3. [Output or deliverable]',
    '',
    '## Constraints',
    '',
    '- Keep output concise and actionable',
    '- Focus on [specific scope]',
    ''
  ].join('\n')
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
    '<!-- Agent instructions define a specialized persona with a clear mission. -->',
    '<!-- Best practices (Anthropic/Claude Code): -->',
    '<!--   - Lead with role identity: "You are a [role] specializing in [domain]" -->',
    '<!--   - Define scope: what the agent SHOULD and SHOULD NOT do -->',
    '<!--   - Specify quality bar: what "done well" looks like -->',
    '<!--   - Include output format preferences if applicable -->',
    '<!--   - Keep instructions focused. One agent, one job. -->',
    '',
    `You are ${description ? description.toLowerCase() : `the ${name} agent`}.`,
    '',
    '## Responsibilities',
    '',
    '- [Primary task this agent handles]',
    '- [Secondary task]',
    '',
    '## Guidelines',
    '',
    '- Be thorough but concise',
    '- Follow existing project patterns and conventions',
    '- Ask for clarification rather than guessing',
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
    '<!-- Skills are reusable instruction sets Claude loads on demand via /skill-name. -->',
    '<!-- Best practices (Miessler PAI / Claude Code official): -->',
    '<!--   - Start with WHEN to use this skill (trigger conditions) -->',
    '<!--   - Define the process as numbered steps -->',
    '<!--   - Include checklists for quality gates -->',
    '<!--   - Specify output format and structure -->',
    '<!--   - Add examples of good vs. bad output -->',
    '<!--   - Keep under 800 lines. Split into prompts/ for long content. -->',
    '',
    '## When to Use',
    '',
    `Use this skill when [describe the trigger condition for ${name}].`,
    '',
    '## Process',
    '',
    '1. **Analyze** the current context',
    '2. **Execute** the core task',
    '3. **Verify** the output meets quality criteria',
    '',
    '## Quality Checklist',
    '',
    '- [ ] Output follows project conventions',
    '- [ ] Edge cases are handled',
    '- [ ] Result is verifiable',
    '',
    '## Examples',
    '',
    '**Good output:**',
    '```',
    '[Example of what success looks like]',
    '```',
    ''
  ].join('\n')
}

export function generateMemoryTemplate(
  name: string,
  description: string,
  memoryType: string
): string {
  const guidance: Record<string, string[]> = {
    feedback: [
      "<!-- Feedback memories capture corrections to Claude's behavior. -->",
      '<!-- Structure: rule first, then Why: (the reason) and How to apply: (when it kicks in) -->',
      '',
      '[State the rule or correction clearly]',
      '',
      '**Why:** [The reason this matters, often a past incident or strong preference]',
      '',
      '**How to apply:** [When and where this guidance kicks in]'
    ],
    project: [
      '<!-- Project memories track decisions, goals, and ongoing work context. -->',
      '<!-- Structure: fact/decision first, then Why: and How to apply: -->',
      '<!-- Tip: Convert relative dates to absolute (e.g., "Thursday" to "2026-03-20") -->',
      '',
      '[State the fact or decision]',
      '',
      '**Why:** [The motivation, constraint, or stakeholder ask]',
      '',
      '**How to apply:** [How this should shape future suggestions]'
    ],
    user: [
      '<!-- User memories help Claude tailor behavior to who you are. -->',
      '<!-- Include: role, expertise level, preferences, how you like to work. -->',
      '<!-- Good user memories help Claude collaborate differently with a -->',
      '<!-- senior engineer vs. a student coding for the first time. -->',
      '',
      '[Describe the relevant aspect of the user: role, expertise, preferences]'
    ],
    reference: [
      '<!-- Reference memories point to where information lives in external systems. -->',
      '<!-- Include: what the resource is, where to find it, when to check it. -->',
      '',
      '[What this resource is and its purpose]',
      '',
      '**Location:** [URL, project name, channel, or system path]',
      '',
      '**When to check:** [What situations should trigger looking at this resource]'
    ]
  }
  const lines = guidance[memoryType] ?? ['Memory content goes here.']
  return [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `type: ${memoryType}`,
    '---',
    '',
    ...lines,
    ''
  ].join('\n')
}

export function generateRuleTemplate(name: string): string {
  const titleCase = name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  return [
    `# ${titleCase}`,
    '',
    '<!-- Rules are concise instructions that Claude follows in every conversation. -->',
    '<!-- Best practices: -->',
    '<!--   - One rule per file. Keep rules atomic and focused. -->',
    '<!--   - Be specific: "Use single quotes in TypeScript" not "Write clean code" -->',
    '<!--   - Include rationale if not obvious (helps Claude apply judgment) -->',
    '<!--   - Rules in common/ apply globally; use subdirs for project-scoped rules -->',
    '',
    '[Clear, specific instruction for Claude to follow]',
    '',
    '**Rationale:** [Why this rule exists, helps Claude apply it correctly in edge cases]',
    ''
  ].join('\n')
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
