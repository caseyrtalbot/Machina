import { useEffect, useState } from 'react'
import type { HarnessAdapter } from '@shared/harness-types'
import { withTimeout } from '../../utils/ipc-timeout'

const HARNESS_BINDING_TIMEOUT_MS = 5_000

export interface HarnessBindingInfo {
  readonly slug: string
  readonly adapter: HarnessAdapter | null
  readonly rawInvocationReady: boolean
}

export type HarnessBindingLookup =
  | { readonly status: 'loading' }
  | { readonly status: 'unbound' }
  | { readonly status: 'unavailable'; readonly message: string }
  | { readonly status: 'bound'; readonly binding: HarnessBindingInfo }

/** Fail-closed main-owned binding lookup shared by display and raw input. */
export function useHarnessBinding(
  threadId: string | undefined,
  invalidation?: string
): HarnessBindingLookup {
  const lookupKey = threadId === undefined ? null : `${threadId}\0${invalidation ?? ''}`
  const [resolved, setResolved] = useState<{
    readonly key: string
    readonly lookup: Exclude<HarnessBindingLookup, { readonly status: 'loading' }>
  } | null>(null)

  useEffect(() => {
    if (threadId === undefined || lookupKey === null) return
    let cancelled = false
    void withTimeout(
      window.api.harness.binding(threadId),
      HARNESS_BINDING_TIMEOUT_MS,
      `harness:binding ${threadId}`
    ).then(
      (binding) => {
        if (!cancelled) {
          setResolved({
            key: lookupKey,
            lookup: binding === null ? { status: 'unbound' } : { status: 'bound', binding }
          })
        }
      },
      (error) => {
        if (!cancelled) {
          setResolved({
            key: lookupKey,
            lookup: {
              status: 'unavailable',
              message: error instanceof Error ? error.message : String(error)
            }
          })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [threadId, lookupKey])

  return resolved !== null && resolved.key === lookupKey ? resolved.lookup : { status: 'loading' }
}
