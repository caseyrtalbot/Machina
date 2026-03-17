// Pure type definitions for parsed ~/.claude/ configuration components.
// No side effects, no imports beyond TypeScript types.

export interface ClaudeSettings {
  readonly permissions: Readonly<Record<string, unknown>>
  readonly envVars: readonly string[]
  readonly plugins: readonly string[]
  readonly allowCount: number
  readonly rawJson: Readonly<Record<string, unknown>>
}

export interface ClaudeAgent {
  readonly name: string
  readonly description: string
  readonly model: string
  readonly tools: readonly string[]
  readonly filePath: string
  readonly instructionPreview: string
}

export interface ClaudeSkill {
  readonly name: string
  readonly description: string
  readonly filePath: string
  readonly promptFiles: readonly string[]
  readonly referenceFiles: readonly string[]
}

export interface ClaudeRule {
  readonly name: string
  readonly category: string
  readonly content: string
  readonly filePath: string
}

export interface ClaudeCommand {
  readonly name: string
  readonly description: string
  readonly content: string
  readonly filePath: string
}

export interface ClaudeTeam {
  readonly name: string
  readonly members: readonly string[]
  readonly lead: string | null
  readonly filePath: string
  readonly rawConfig: Readonly<Record<string, unknown>>
}

export interface ClaudeMemory {
  readonly name: string
  readonly description: string
  readonly memoryType: string
  readonly content: string
  readonly filePath: string
  readonly links: readonly string[]
}

export interface ClaudeConfig {
  readonly basePath: string
  readonly settings: ClaudeSettings | null
  readonly agents: readonly ClaudeAgent[]
  readonly skills: readonly ClaudeSkill[]
  readonly rules: readonly ClaudeRule[]
  readonly commands: readonly ClaudeCommand[]
  readonly teams: readonly ClaudeTeam[]
  readonly memories: readonly ClaudeMemory[]
}
