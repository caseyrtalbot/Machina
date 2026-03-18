import { createContext, useContext } from 'react'

type InspectorCallback = (path: string, title: string) => void

const InspectorContext = createContext<InspectorCallback | null>(null)

export const InspectorProvider = InspectorContext.Provider
// eslint-disable-next-line react-refresh/only-export-components
export const useInspector = () => useContext(InspectorContext)
