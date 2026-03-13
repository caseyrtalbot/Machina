import { create } from 'zustand'

interface TerminalSession {
  id: string
  title: string
}

interface TerminalStore {
  sessions: TerminalSession[]
  activeSessionId: string | null

  addSession: (session: TerminalSession) => void
  removeSession: (id: string) => void
  setActiveSession: (id: string) => void
  renameSession: (id: string, title: string) => void
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  sessions: [],
  activeSessionId: null,

  addSession: (session) =>
    set((s) => ({
      sessions: [...s.sessions, session],
      activeSessionId: session.id
    })),
  removeSession: (id) =>
    set((s) => {
      const sessions = s.sessions.filter((t) => t.id !== id)
      const activeSessionId =
        s.activeSessionId === id ? (sessions[sessions.length - 1]?.id ?? null) : s.activeSessionId
      return { sessions, activeSessionId }
    }),
  setActiveSession: (id) => set({ activeSessionId: id }),
  renameSession: (id, title) =>
    set((s) => ({
      sessions: s.sessions.map((t) => (t.id === id ? { ...t, title } : t))
    }))
}))
