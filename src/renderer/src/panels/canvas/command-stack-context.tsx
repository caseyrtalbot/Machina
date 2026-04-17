import { createContext, useContext } from 'react'
import type { CommandStack } from './canvas-commands'

const CommandStackContext = createContext<CommandStack | null>(null)

export const CommandStackProvider = CommandStackContext.Provider

export function useCommandStack(): CommandStack | null {
  return useContext(CommandStackContext)
}
