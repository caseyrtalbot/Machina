import { createContext, useContext } from 'react'
import type { CommandStack } from './canvas-commands'

const CommandStackContext = createContext<CommandStack | null>(null)

export const CommandStackProvider = CommandStackContext.Provider

// eslint-disable-next-line react-refresh/only-export-components
export function useCommandStack(): CommandStack | null {
  return useContext(CommandStackContext)
}
