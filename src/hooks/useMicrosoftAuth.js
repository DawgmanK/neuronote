import { useState, useEffect, useCallback } from 'react'
import {
  MS_AUTH_EVENT,
  isSignedIn,
  getUserEmail,
  getClientId,
  getTenantId,
  ensureInitialized,
  signIn as authSignIn,
  signOut as authSignOut
} from '../services/microsoft-auth'

// The Microsoft counterpart of useGoogleAuth. MSAL refreshes tokens on its own,
// so there is no expiry poll here — the service dispatches MS_AUTH_EVENT
// whenever the connected account actually changes.
export default function useMicrosoftAuth() {
  const [signedIn, setSignedIn] = useState(() => isSignedIn())
  const [email, setEmail] = useState(() => getUserEmail())
  const [clientId, setClientId] = useState(() => getClientId())
  const [tenantId, setTenantId] = useState(() => getTenantId())
  const [signingIn, setSigningIn] = useState(false)

  const refresh = useCallback(() => {
    setSignedIn(isSignedIn())
    setEmail(getUserEmail())
    setClientId(getClientId())
    setTenantId(getTenantId())
  }, [])

  useEffect(() => {
    let cancelled = false
    refresh()
    // Bring MSAL up so the badge reflects its real cache, not just our mirror.
    ensureInitialized().then(() => { if (!cancelled) refresh() })

    const onChange = () => refresh()
    window.addEventListener(MS_AUTH_EVENT, onChange)
    window.addEventListener('focus', onChange)
    return () => {
      cancelled = true
      window.removeEventListener(MS_AUTH_EVENT, onChange)
      window.removeEventListener('focus', onChange)
    }
  }, [refresh])

  // v2.5.1 — sign-in is a full-page redirect to Microsoft, so on the happy path
  // this never resolves: the document is torn down mid-await and `signingIn`
  // simply stays true until the browser navigates. It settles only when the
  // redirect could not be started, which is a genuine failure.
  const signIn = useCallback(async ({ returnTo = null } = {}) => {
    setSigningIn(true)
    try {
      return await authSignIn({ returnTo })
    } catch (err) {
      setSigningIn(false)
      throw err
    }
  }, [])

  const signOut = useCallback(async () => {
    await authSignOut()
    refresh()
  }, [refresh])

  return { signedIn, email, clientId, tenantId, signingIn, signIn, signOut, refresh }
}
