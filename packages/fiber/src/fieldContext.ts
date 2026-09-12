import { createContext, useContext } from 'react'

export interface FieldContextValue {
  controlId: string
  describedBy?: string
  invalid: boolean
  required: boolean
}

export const fieldContext = createContext<FieldContextValue | null>(null)

export function useFieldContext() {
  return useContext(fieldContext)
}
