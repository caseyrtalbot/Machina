import { createContext } from 'react'
import type { CommandStack } from './canvas-commands'

const CommandStackContext = createContext<CommandStack | null>(null)

export const CommandStackProvider = CommandStackContext.Provider
