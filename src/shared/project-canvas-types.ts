export interface ProjectFileInfo {
  readonly path: string
  readonly relativePath: string
  readonly language: string
  readonly size: number
  readonly lastModified: number
  readonly touchCount: number
  readonly lastTouchedBy: string | null
}

export interface ProjectSessionEvent {
  readonly type: 'file-read' | 'file-write' | 'file-edit' | 'bash-command' | 'user-prompt'
  readonly timestamp: number
  readonly sessionId: string
  readonly filePath?: string
  readonly detail?: string
}

export interface ProjectFileChangedEvent {
  readonly path: string
  readonly event: 'add' | 'change' | 'unlink'
  readonly relativePath: string
}
