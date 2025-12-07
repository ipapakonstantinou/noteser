import { useState, useEffect } from 'react'

/**
 * Hook to track client-side hydration.
 * Returns false on the server and during initial hydration,
 * returns true after the component has hydrated on the client.
 *
 * This is useful for components that use persisted state (like Zustand with persist)
 * to avoid hydration mismatches between server and client.
 */
export function useHydration() {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  return hydrated
}
