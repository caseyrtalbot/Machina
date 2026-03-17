import { createContext, useContext } from 'react'

type InspectorCallback = (path: string, title: string) => void

const InspectorContext = createContext<InspectorCallback | null>(null)

export const InspectorProvider = InspectorContext.Provider
export const useInspector = () => useContext(InspectorContext)
