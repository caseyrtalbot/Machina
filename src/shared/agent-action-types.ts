import type { CanvasNodeType } from './canvas-types'
import type { CanvasMutationPlan } from './canvas-mutation-types'

// ---------------------------------------------------------------------------
// Action Registry
// ---------------------------------------------------------------------------

export interface AgentActionDef {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly requiresSelection: number // 0 = no selection needed, N = minimum card count
  readonly keywords: readonly string[]
}

export const AGENT_ACTIONS = [
  {
    id: 'challenge',
    label: '/challenge',
    description: 'Stress-test ideas, surface contradictions and assumptions',
    requiresSelection: 1,
    keywords: ['challenge', 'question', 'contradict', 'assumption', 'stress']
  },
  {
    id: 'emerge',
    label: '/emerge',
    description: 'Surface hidden connections, synthesize across content',
    requiresSelection: 1,
    keywords: ['emerge', 'connect', 'synthesize', 'discover', 'link']
  },
  {
    id: 'organize',
    label: '/organize',
    description: 'Group cards by theme and arrange spatially',
    requiresSelection: 2,
    keywords: ['organize', 'group', 'cluster', 'arrange', 'sort']
  },
  {
    id: 'tidy',
    label: '/tidy',
    description: 'Clean up layout: resolve overlaps, align, improve spacing',
    requiresSelection: 0,
    keywords: ['tidy', 'clean', 'align', 'layout', 'spacing', 'overlap']
  }
] as const satisfies readonly AgentActionDef[]

export const AGENT_ACTION_NAMES = AGENT_ACTIONS.map((a) => a.id) as AgentActionName[]

export type AgentActionName = (typeof AGENT_ACTIONS)[number]['id']

// ---------------------------------------------------------------------------
// Context (renderer -> main)
// ---------------------------------------------------------------------------

export interface AgentCardContext {
  readonly id: string
  readonly type: CanvasNodeType
  readonly title: string
  readonly body: string
  readonly tags: readonly string[]
  readonly position: { readonly x: number; readonly y: number }
  readonly size: { readonly width: number; readonly height: number }
}

export interface AgentNeighborContext {
  readonly id: string
  readonly title: string
  readonly tags: readonly string[]
  readonly edgeKind: string
}

export interface AgentEdgeContext {
  readonly id: string
  readonly fromNode: string
  readonly toNode: string
  readonly kind?: string
  readonly label?: string
}

export interface AgentContext {
  readonly action: AgentActionName
  readonly selectedCards: readonly AgentCardContext[]
  readonly neighbors: readonly AgentNeighborContext[]
  readonly edges: readonly AgentEdgeContext[]
  readonly canvasMeta: {
    readonly viewportBounds: {
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }
    readonly totalCardCount: number
  }
}

// ---------------------------------------------------------------------------
// IPC Request / Response
// ---------------------------------------------------------------------------

export interface AgentActionRequest {
  readonly action: AgentActionName
  readonly context: AgentContext
}

export type AgentActionResponse = { readonly plan: CanvasMutationPlan } | { readonly error: string }
