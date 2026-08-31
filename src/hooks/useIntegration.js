import { useState, useEffect, useCallback, useMemo } from 'react'
import useGoogleAuth from './useGoogleAuth'
import useMicrosoftAuth from './useMicrosoftAuth'
import {
  PROVIDER_EVENT,
  getProvider,
  setProvider as persistProvider,
  googleEnabled,
  microsoftEnabled
} from '../lib/integration-provider'

/**
 * v2.5 — one place to ask "where do action items go?".
 *
 * A provider counts as *active* only when the user has selected it in the
 * SYSTEM tab AND it is signed in, so switching the selector to "Google" hides
 * the Microsoft buttons without disconnecting the account.
 */
export default function useIntegration() {
  const google = useGoogleAuth()
  const microsoft = useMicrosoftAuth()
  const [provider, setProviderState] = useState(() => getProvider())

  useEffect(() => {
    const onChange = () => setProviderState(getProvider())
    window.addEventListener(PROVIDER_EVENT, onChange)
    // Another tab writing the preference should be picked up too.
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(PROVIDER_EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  const setProvider = useCallback((next) => {
    setProviderState(persistProvider(next))
  }, [])

  const showGoogle = googleEnabled(provider)
  const showMicrosoft = microsoftEnabled(provider)
  const googleActive = showGoogle && google.signedIn
  const microsoftActive = showMicrosoft && microsoft.signedIn

  const activeProviders = useMemo(() => {
    const list = []
    if (googleActive) list.push('google')
    if (microsoftActive) list.push('microsoft')
    return list
  }, [googleActive, microsoftActive])

  return {
    provider,
    setProvider,
    google,
    microsoft,
    // Selected in the SYSTEM tab (section visibility).
    showGoogle,
    showMicrosoft,
    // Selected *and* connected (button visibility).
    googleActive,
    microsoftActive,
    activeProviders,
    anyActive: activeProviders.length > 0,
    bothActive: activeProviders.length === 2,
    /** The provider to use when only one is available. */
    defaultTarget: activeProviders[0] || null
  }
}
