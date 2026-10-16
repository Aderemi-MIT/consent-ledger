import { useEffect, useState } from 'react'

/**
 * useState that survives switching tabs and reloading the page within the
 * browser session, so a participant's chosen patient or provider stays
 * selected as they move between roles.
 */
export function usePersisted(key: string, initial: string): [string, (v: string) => void] {
  const [value, setValue] = useState<string>(() => {
    try {
      return sessionStorage.getItem(`consentledger.${key}`) ?? initial
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(`consentledger.${key}`, value)
    } catch {
      // Storage unavailable: the selection just resets on tab switch.
    }
  }, [key, value])
  return [value, setValue]
}
