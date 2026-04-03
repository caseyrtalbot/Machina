export interface ClaudeStatus {
  readonly installed: boolean
  readonly authenticated: boolean
  readonly version: string | null
  readonly email: string | null
  readonly subscriptionType: string | null
  readonly lastChecked: number
  readonly error: string | null
}

export const CLAUDE_STATUS_INITIAL: ClaudeStatus = {
  installed: false,
  authenticated: false,
  version: null,
  email: null,
  subscriptionType: null,
  lastChecked: 0,
  error: null
}
