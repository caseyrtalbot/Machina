import { create } from 'zustand'

// ---------------------------------------------------------------------------
// Group rules: user-defined pattern → color mapping for node coloring.
// Evaluated top-to-bottom, first match wins. Unmatched notes → default gray.
// ---------------------------------------------------------------------------

export interface GroupRule {
  id: string
  query: string // e.g., 'tag:#first-principles' or 'path:"Projects"'
  color: string
}

const GROUP_COLOR_PALETTE = [
  '#e8555a',
  '#4a9eff',
  '#4ade80',
  '#f59e0b',
  '#a78bfa',
  '#f472b6',
  '#22d3ee',
  '#fb923c'
] as const

const DEFAULT_GROUP_RULES: GroupRule[] = [
  { id: '1', query: 'tag:#first-principles', color: '#e8555a' },
  { id: '2', query: 'path:"Projects"', color: '#4a9eff' },
  { id: '3', query: 'path:"Books"', color: '#4ade80' },
  { id: '4', query: 'tag:#daily', color: '#f59e0b' }
]

interface GraphSettingsState {
  // Filters
  readonly graphMode: 'global' | 'local'
  readonly localGraphDepth: number
  readonly searchQuery: string
  readonly showOrphans: boolean
  readonly showExistingOnly: boolean
  readonly showTags: boolean
  readonly showAttachments: boolean

  // Groups (coloring)
  readonly groupRules: readonly GroupRule[]

  // Display
  readonly nodeSizeMultiplier: number
  readonly linkThickness: number
  readonly showArrows: boolean
  readonly textFadeThreshold: number
  readonly isAnimating: boolean
  readonly showMinimap: boolean

  // Forces
  readonly centerForce: number
  readonly repelForce: number
  readonly linkForce: number
  readonly linkDistance: number
  readonly enableRadial: boolean

  // Setters
  setGraphMode: (mode: 'global' | 'local') => void
  setLocalGraphDepth: (depth: number) => void
  setSearchQuery: (value: string) => void
  setShowOrphans: (value: boolean) => void
  setShowExistingOnly: (value: boolean) => void
  setShowTags: (value: boolean) => void
  setShowAttachments: (value: boolean) => void
  setGroupRules: (rules: GroupRule[]) => void
  addGroupRule: () => void
  removeGroupRule: (id: string) => void
  updateGroupRule: (id: string, updates: Partial<Omit<GroupRule, 'id'>>) => void
  cycleGroupColor: (id: string) => void
  setNodeSizeMultiplier: (value: number) => void
  setLinkThickness: (value: number) => void
  setShowArrows: (value: boolean) => void
  setTextFadeThreshold: (value: number) => void
  setIsAnimating: (value: boolean) => void
  setShowMinimap: (value: boolean) => void
  setCenterForce: (value: number) => void
  setRepelForce: (value: number) => void
  setLinkForce: (value: number) => void
  setLinkDistance: (value: number) => void
  setEnableRadial: (value: boolean) => void
}

let nextRuleId = 100

export const useGraphSettingsStore = create<GraphSettingsState>()((set, get) => ({
  // Filters
  graphMode: 'global',
  localGraphDepth: 2,
  searchQuery: '',
  showOrphans: true,
  showExistingOnly: false,
  showTags: true,
  showAttachments: true,

  // Groups
  groupRules: DEFAULT_GROUP_RULES,

  // Display
  nodeSizeMultiplier: 1,
  linkThickness: 1,
  showArrows: false,
  textFadeThreshold: 1.2,
  isAnimating: true,
  showMinimap: true,

  // Forces (Obsidian-style defaults)
  centerForce: 0.02,
  repelForce: -120,
  linkForce: 0.7,
  linkDistance: 50,
  enableRadial: false,

  // Setters
  setGraphMode: (mode) => set({ graphMode: mode }),
  setLocalGraphDepth: (depth) => set({ localGraphDepth: depth }),
  setSearchQuery: (value) => set({ searchQuery: value }),
  setShowOrphans: (value) => set({ showOrphans: value }),
  setShowExistingOnly: (value) => set({ showExistingOnly: value }),
  setShowTags: (value) => set({ showTags: value }),
  setShowAttachments: (value) => set({ showAttachments: value }),

  setGroupRules: (rules) => set({ groupRules: rules }),

  addGroupRule: () => {
    const rules = get().groupRules
    const colorIndex = rules.length % GROUP_COLOR_PALETTE.length
    set({
      groupRules: [
        ...rules,
        {
          id: String(nextRuleId++),
          query: '',
          color: GROUP_COLOR_PALETTE[colorIndex]
        }
      ]
    })
  },

  removeGroupRule: (id) => {
    set({ groupRules: get().groupRules.filter((r) => r.id !== id) })
  },

  updateGroupRule: (id, updates) => {
    set({
      groupRules: get().groupRules.map((r) => (r.id === id ? { ...r, ...updates } : r))
    })
  },

  cycleGroupColor: (id) => {
    const rules = get().groupRules
    const rule = rules.find((r) => r.id === id)
    if (!rule) return
    const currentIndex = GROUP_COLOR_PALETTE.indexOf(
      rule.color as (typeof GROUP_COLOR_PALETTE)[number]
    )
    const nextIndex = (currentIndex + 1) % GROUP_COLOR_PALETTE.length
    set({
      groupRules: rules.map((r) =>
        r.id === id ? { ...r, color: GROUP_COLOR_PALETTE[nextIndex] } : r
      )
    })
  },

  setNodeSizeMultiplier: (value) => set({ nodeSizeMultiplier: value }),
  setLinkThickness: (value) => set({ linkThickness: value }),
  setShowArrows: (value) => set({ showArrows: value }),
  setTextFadeThreshold: (value) => set({ textFadeThreshold: value }),
  setIsAnimating: (value) => set({ isAnimating: value }),
  setShowMinimap: (value) => set({ showMinimap: value }),
  setCenterForce: (value) => set({ centerForce: value }),
  setRepelForce: (value) => set({ repelForce: value }),
  setLinkForce: (value) => set({ linkForce: value }),
  setLinkDistance: (value) => set({ linkDistance: value }),
  setEnableRadial: (value) => set({ enableRadial: value })
}))

// ---------------------------------------------------------------------------
// Group rule matching
// ---------------------------------------------------------------------------

export function matchGroupRule(
  rule: GroupRule,
  node: { type: string; tags?: string[]; path?: string }
): boolean {
  const q = rule.query.trim()
  if (!q) return false

  if (q.startsWith('tag:')) {
    const tag = q.slice(4)
    if (!tag) return false
    // Match against node tags (with or without # prefix)
    const normalized = tag.startsWith('#') ? tag.slice(1) : tag
    return node.tags?.some((t) => t.toLowerCase() === normalized.toLowerCase()) ?? false
  }

  if (q.startsWith('path:')) {
    const raw = q.slice(5).replace(/"/g, '')
    if (!raw) return false
    return node.path?.toLowerCase().includes(raw.toLowerCase()) ?? false
  }

  // Fallback: match type name
  return node.type === q
}

/**
 * Resolve the display color for a node by evaluating group rules top-to-bottom.
 * Returns null if no rule matches (caller should use default colors).
 */
export function resolveGroupColor(
  rules: readonly GroupRule[],
  node: { type: string; tags?: string[]; path?: string }
): string | null {
  for (const rule of rules) {
    if (matchGroupRule(rule, node)) return rule.color
  }
  return null
}
