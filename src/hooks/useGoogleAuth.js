import { useState, useEffect, useCallback } from 'react'
import {
  AUTH_EVENT,
  isSignedIn,
  hasAutoRefresh,
  getAccountEmail,
  getClientId,
  getClientSecret,
  signIn as authSignIn,
  signOut as authSignOut
} from '../services/google-auth'

// Keeps every component that cares about Google connectivity in sync — the
// service dispatches AUTH_EVENT on sign-in, sign-out, and token expiry.
export default function useGoogleAuth() {
  const [signedIn, setSignedIn] = useState(() => isSignedIn())
  const [email, setEmail] = useState(() => getAccountEmail())
  const [clientId, setClientId] = useState(() => getClientId())
  // v2.6 — true once a refresh token is stored, i.e. the session renews itself.
  const [autoRefresh, setAutoRefresh] = useState(() => hasAutoRefresh())
  const [hasClientSecret, setHasClientSecret] = useState(() => !!getClientSecret())
  const [signingIn, setSigningIn] = useState(false)

  const refresh = useCallback(() => {
    setSignedIn(isSignedIn())
    setEmail(getAccountEmail())
    setClientId(getClientId())
    setAutoRefresh(hasAutoRefresh())
    setHasClientSecret(!!getClientSecret())
  }, [])

  useEffect(() => {
    refresh()
    const onChange = () => refresh()
    window.addEventListener(AUTH_EVENT, onChange)
    window.addEventListener('focus', onChange)
    return () => {
      window.removeEventListener(AUTH_EVENT, onChange)
      window.removeEventListener('focus', onChange)
    }
  }, [refresh])

  // v2.6 keeps the session alive on its own, but a slow poll still catches a
  // token cleared in another tab or a refresh that failed while backgrounded.
  useEffect(() => {
    const interval = setInterval(refresh, 60000)
    return () => clearInterval(interval)
  }, [refresh])

  const signIn = useCallback(async () => {
    setSigningIn(true)
    try {
      const token = await authSignIn()
      refresh()
      return token
    } finally {
      setSigningIn(false)
    }
  }, [refresh])

  const signOut = useCallback(() => {
    authSignOut()
    refresh()
  }, [refresh])

  return { signedIn, email, clientId, autoRefresh, hasClientSecret, signingIn, signIn, signOut, refresh }
}
