import { create } from 'zustand'
import type { Block, BlockId } from '@shared/engine/block-model'

interface BlockStore {
  readonly blocksBySession: Readonly<Record<string, readonly Block[]>>
  applyUpdate: (sessionId: string, block: Block) => void
  clearSession: (sessionId: string) => void
  getBlocks: (sessionId: string) => readonly Block[]
  getBlock: (sessionId: string, blockId: BlockId | string) => Block | undefined
}

export const useBlockStore = create<BlockStore>((set, get) => ({
  blocksBySession: {},

  applyUpdate: (sessionId, block) =>
    set((s) => {
      const existing = s.blocksBySession[sessionId] ?? []
      const idx = existing.findIndex((b) => b.id === block.id)
      const nextList: readonly Block[] =
        idx >= 0 ? existing.map((b, i) => (i === idx ? block : b)) : [...existing, block]
      return {
        blocksBySession: { ...s.blocksBySession, [sessionId]: nextList }
      }
    }),

  clearSession: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.blocksBySession)) return s
      const { [sessionId]: _removed, ...rest } = s.blocksBySession
      return { blocksBySession: rest }
    }),

  getBlocks: (sessionId) => get().blocksBySession[sessionId] ?? [],

  getBlock: (sessionId, blockId) => {
    const list = get().blocksBySession[sessionId]
    if (!list) return undefined
    return list.find((b) => b.id === blockId)
  }
}))
