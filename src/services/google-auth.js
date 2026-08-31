// Google OAuth 2.0 — authorization code flow with PKCE (v2.6).
//
// v2.1-v2.5.1 used google.accounts.oauth2.initTokenClient(), the implicit
// flow. That hands back a one-hour access token and nothing else, so the user
// had to sign in again every hour. v2.6 switches to initCodeClient(), which
// returns an authorization *code*; exchanging that code at Google's token
// endpoint yields an access token AND a long-lived refresh token, so the app
// can renew silently in the background the way MSAL already does for
// Microsoft.
//
// Still browser-only: the PKCE code_verifier replaces the client secret for
// public clients. Some Google client types ("Web application") additionally
// insist on a client secret at the token endpoint; if the exchange comes back
// asking for one, the SYSTEM tab exposes an optional field for it. Nothing is
// ever sent anywhere but accounts.google.com / oauth2.googleapis.com.
import { getItem, setItem, removeItem } from '../lib/storage.js'

const TOKENS_KEY = 'google:tokens'          // -> "neuronote:google:tokens"
const LEGACY_TOKEN_KEY = 'google:token'     // v2.1-v2.5.1 implicit-flow token
const CLIENT_ID_KEY = 'google:clientid'
const CLIENT_SECRET_KEY = 'google:clientsecret'
const EVER_CONNECTED_KEY = 'google:everconnected'

// Temporary by design: the verifier is only needed between opening the consent
// popup and exchanging the code, so it lives in sessionStorage, not local.
const PKCE_VERIFIER_KEY = 'neuronote:google:pkce_verifier'

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo'

// calendar.events + tasks are required for writing. userinfo.email and openid
// let us name the connected account without a second round trip — the id_token
// carries it.
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid'
].join(' ')

/** Fired on window whenever sign-in state changes so any component can react. */
export const AUTH_EVENT = 'neuronote:google:auth-changed'

/**
 * Fired when the stored credentials are gone or no longer usable and only the
 * user can fix it (refresh token revoked, iOS cleared localStorage, an old
 * implicit-flow token was migrated away). App.jsx turns this into a
 * non-blocking toast with a "Sign In" button.
 */
export const REAUTH_EVENT = 'neuronote:google:reauth-required'

/** Shown after every successful sign-in, wherever it was started from. */
export const SIGNED_IN_MESSAGE =
  "Google signed in — you'll stay signed in as long as you use the app regularly."

/** Shown when a v2.5.1 token was migrated away and one more consent is needed. */
export const MIGRATION_MESSAGE =
  'Google sign-in has been improved. Please sign in once more to activate auto-refresh.'

/** Renew once the access token is within five minutes of expiring. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000
/** Proactive renewal while the app stays open, comfortably inside the hour. */
const BACKGROUND_REFRESH_MS = 55 * 60 * 1000

const LOG = '[NeuroNote:GoogleAuth]'

/**
 * GIS popup mode relays the authorization code back through Google's own
 * postMessage bridge, so the code is minted against this literal value rather
 * than the app origin. No extra redirect URI has to be registered.
 */
const GIS_REDIRECT_URI = 'postmessage'

/**
 * Whether google.accounts.oauth2.initCodeClient() carries our PKCE challenge
 * through to the authorization request.
 *
 * It does not. CodeClientConfig is a fixed allowlist (client_id, scope,
 * ux_mode, redirect_uri, state, hint, callback, ...) and drops anything it
 * does not recognise, code_challenge included. The code therefore arrives at
 * the token endpoint with no challenge bound to it, and posting a
 * code_verifier against it fails with "invalid_grant: Bad Request" — which is
 * exactly what v2.6.0 did.
 *
 * The persistent session does not depend on PKCE: what keeps the user signed
 * in is the refresh token, and the authorization code flow issues that either
 * way. PKCE would replace the client secret for a *public* OAuth client, but
 * Google treats a "Web application" client as confidential and asks for the
 * secret regardless. The whole verifier/challenge path below stays wired up
 * and switches back on with this one flag if GIS ever forwards the parameters.
 */
const GIS_SUPPORTS_PKCE = false

let pendingSignIn = null
let pendingRefresh = null
let refreshTimer = null

// --- events ---------------------------------------------------------------

function emitChange() {
  const detail = { signedIn: isSignedIn(), email: getAccountEmail(), autoRefresh: hasAutoRefresh() }
  console.log(`${LOG} Auth state changed:`, detail)
  try {
    window.dispatchEvent(new CustomEvent(AUTH_EVENT, { detail }))
  } catch (err) {
    console.error(`${LOG} Failed to dispatch auth event:`, err)
  }
}

function emitReauthRequired(reason, message) {
  console.warn(`${LOG} Re-auth required (${reason}): ${message}`)
  try {
    window.dispatchEvent(new CustomEvent(REAUTH_EVENT, { detail: { reason, message } }))
  } catch (err) {
    console.error(`${LOG} Failed to dispatch re-auth event:`, err)
  }
}

// --- credentials ----------------------------------------------------------

export function getClientId() {
  return getItem(CLIENT_ID_KEY) || ''
}

export function saveClientId(clientId) {
  const trimmed = (clientId || '').trim()
  console.log(`${LOG} Saving Client ID (length %d)`, trimmed.length)
  setItem(CLIENT_ID_KEY, trimmed)
  // A new Client ID invalidates every token issued under the old one.
  signOut()
  return trimmed
}

export function clearClientId() {
  console.log(`${LOG} Clearing Client ID`)
  removeItem(CLIENT_ID_KEY)
  removeItem(CLIENT_SECRET_KEY)
  signOut()
}

/**
 * Optional. Google issues refresh tokens to browser clients under PKCE alone,
 * but an OAuth client registered as "Web application" is treated as a
 * confidential client and its token endpoint rejects the exchange without a
 * secret. Storing it here is no worse than the OpenAI/AssemblyAI keys this app
 * already keeps in localStorage, and it is only ever posted to Google.
 */
export function getClientSecret() {
  return getItem(CLIENT_SECRET_KEY) || ''
}

export function saveClientSecret(secret) {
  const trimmed = (secret || '').trim()
  console.log(`${LOG} Saving optional client secret (length %d)`, trimmed.length)
  setItem(CLIENT_SECRET_KEY, trimmed)
  return trimmed
}

export function clearClientSecret() {
  console.log(`${LOG} Clearing optional client secret`)
  removeItem(CLIENT_SECRET_KEY)
}

// --- token storage --------------------------------------------------------

function getStoredTokens() {
  const stored = getItem(TOKENS_KEY)
  if (!stored || typeof stored !== 'object') return null
  if (!stored.access_token && !stored.refresh_token) return null
  return stored
}

function storeTokens(tokens) {
  setItem(TOKENS_KEY, tokens)
  console.log(`${LOG} Tokens stored — access token expires %s, refresh token %s`,
    new Date(tokens.expires_at).toISOString(),
    tokens.refresh_token ? 'present' : 'MISSING')
}

function clearTokens() {
  removeItem(TOKENS_KEY)
  stopBackgroundRefresh()
  console.log(`${LOG} Stored tokens cleared`)
}

/**
 * v2.6 migration. A v2.1-v2.5.1 install has an implicit-flow token under the
 * singular "google:token" key; it has no refresh token, so it cannot be
 * upgraded in place. Drop it and ask for one fresh sign-in.
 * @returns {boolean} whether a legacy token was found and removed
 */
export function migrateLegacyToken() {
  const legacy = getItem(LEGACY_TOKEN_KEY)
  if (!legacy) return false
  removeItem(LEGACY_TOKEN_KEY)
  if (getStoredTokens()) {
    console.log(`${LOG} Removed a stale v2.5.1 token; v2.6 tokens already present`)
    return false
  }
  console.log(`${LOG} Migrated away from the v2.5.1 implicit-flow token — one more sign-in needed for auto-refresh`)
  return true
}

// --- PKCE -----------------------------------------------------------------

/** URL-safe base64 with the padding stripped, per RFC 7636. */
function base64UrlEncode(bytes) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** 96 random bytes -> a 128-character verifier. */
async function generateCodeVerifier() {
  const array = new Uint8Array(96)
  crypto.getRandomValues(array)
  return base64UrlEncode(array)
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return base64UrlEncode(new Uint8Array(hash))
}

function storeVerifier(verifier) {
  try {
    sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier)
  } catch (err) {
    console.warn(`${LOG} Could not persist the PKCE verifier to sessionStorage:`, err)
  }
}

function readVerifier() {
  try {
    return sessionStorage.getItem(PKCE_VERIFIER_KEY) || ''
  } catch {
    return ''
  }
}

function clearVerifier() {
  try {
    sessionStorage.removeItem(PKCE_VERIFIER_KEY)
  } catch {
    // Nothing to do — a verifier is single-use and harmless if it lingers.
  }
}

// --- Google Identity Services ---------------------------------------------

/** Waits for the GIS script (loaded from index.html) to finish initializing. */
function waitForGis(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve(window.google.accounts.oauth2)
      return
    }
    console.log(`${LOG} Waiting for Google Identity Services script...`)
    const started = Date.now()
    const interval = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(interval)
        console.log(`${LOG} Google Identity Services ready after %dms`, Date.now() - started)
        resolve(window.google.accounts.oauth2)
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(interval)
        const err = new Error('Google Identity Services failed to load. Check your network connection or ad blocker.')
        console.error(`${LOG} GIS load timeout:`, err)
        reject(err)
      }
    }, 100)
  })
}

/**
 * Build a fresh authorization-code client. Not cached: every sign-in carries
 * its own PKCE challenge, so reusing a client would reuse a spent challenge.
 * @param {string} clientId
 * @param {string} codeChallenge base64url SHA-256 of the current verifier
 * @returns {Promise<object>} the GIS code client
 */
export async function initGoogleAuth(clientId, codeChallenge) {
  const id = (clientId || getClientId() || '').trim()
  console.log(`${LOG} initGoogleAuth called, clientId present:`, !!id)
  if (!id) throw new Error('No Google OAuth Client ID configured. Add one in the SYSTEM tab.')

  const oauth2 = await waitForGis()
  const client = oauth2.initCodeClient({
    client_id: id,
    scope: GOOGLE_SCOPES,
    ux_mode: 'popup',
    // Required for a refresh token to be issued at all...
    access_type: 'offline',
    // ...and required for Google to issue one again on a repeat consent.
    prompt: 'consent',
    // See GIS_SUPPORTS_PKCE: sending these to a GIS build that drops them is
    // what makes the exchange fail, because the verifier then matches nothing.
    ...(GIS_SUPPORTS_PKCE ? { code_challenge: codeChallenge, code_challenge_method: 'S256' } : {}),
    callback: () => {},      // replaced per-request in signIn()
    error_callback: () => {}
  })
  console.log(`${LOG} Code client initialized for scopes:`, GOOGLE_SCOPES)
  return client
}

// --- token endpoint -------------------------------------------------------

async function postToTokenEndpoint(params) {
  const body = new URLSearchParams(params)
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })
  const text = await res.text()
  let data = null
  try {
    // JSON.parse only — never eval()/new Function(); CSP would block it and it
    // would be unsafe regardless.
    data = JSON.parse(text)
  } catch {
    data = null
  }
  return { ok: res.ok, status: res.status, data, text }
}

function describeTokenError(status, data, text) {
  const code = data?.error || `http_${status}`
  const description = data?.error_description || text || 'Unknown error'
  const raw = `${code}: ${description}`

  if (/client_secret/i.test(description) || code === 'invalid_client') {
    return {
      code,
      message: 'Google requires a client secret for this OAuth client. Paste it into the ' +
        '"Client Secret" field in the SYSTEM tab (Cloud Console → Credentials → your OAuth ' +
        `client → Client secret) and sign in again. [${raw}]`
    }
  }
  if (code === 'invalid_grant') {
    return {
      code,
      message: 'Google rejected the authorization code. Sign in again — if it keeps failing, ' +
        'check that the Client ID in the SYSTEM tab belongs to the same Cloud project whose ' +
        `consent screen you approved. [${raw}]`
    }
  }
  if (code === 'redirect_uri_mismatch') {
    return {
      code,
      message: 'Google rejected the redirect URI for this OAuth client. Confirm the app origin ' +
        `is listed under Authorized JavaScript origins in Cloud Console. [${raw}]`
    }
  }
  return { code, message: raw }
}

/**
 * Trade the authorization code for tokens. Exactly one attempt, by design.
 *
 * An OAuth authorization code is single-use: Google invalidates it the moment
 * an exchange is attempted, successfully or not. v2.6.0 tried three parameter
 * combinations in a row, so a failure on the first burned the code and the
 * next two could only ever come back "invalid_grant" — reporting the last
 * attempt's error and hiding the one that actually mattered. One attempt, and
 * whatever Google says is what the user is told.
 *
 * The redirect_uri has to match the one the code was minted against. GIS popup
 * mode relays the code through Google's own postMessage bridge, so that value
 * is the literal string "postmessage" — not the app origin.
 */
async function exchangeCodeForTokens(code, verifier, clientId) {
  const secret = getClientSecret()
  const params = {
    code,
    client_id: clientId,
    grant_type: 'authorization_code',
    redirect_uri: GIS_REDIRECT_URI
  }
  // Only ever sent when GIS actually carried our challenge to Google. Sending
  // a verifier for a code with no challenge bound to it is itself an
  // invalid_grant.
  if (GIS_SUPPORTS_PKCE && verifier) params.code_verifier = verifier
  if (secret) params.client_secret = secret

  console.log(`${LOG} Exchanging authorization code (redirect_uri=%s, pkce=%s, secret=%s)`,
    GIS_REDIRECT_URI, GIS_SUPPORTS_PKCE, secret ? 'yes' : 'no')

  const { ok, status, data, text } = await postToTokenEndpoint(params)
  if (ok && data?.access_token) {
    console.log(`${LOG} Code exchange succeeded — refresh token %s`,
      data.refresh_token ? 'issued' : 'NOT issued')
    if (!data.refresh_token) {
      console.warn(`${LOG} Google did not return a refresh_token. Revoke NeuroNote at ` +
        'https://myaccount.google.com/permissions and sign in again — Google only issues a ' +
        'refresh token on a fresh consent.')
    }
    return data
  }

  // Everything Google said, unedited, so a failure can be diagnosed from the
  // console rather than guessed at.
  console.error(`${LOG} Code exchange failed — HTTP ${status}. Raw response from Google:`, text)
  const err = describeTokenError(status, data, text)
  console.error(`${LOG} ${err.message}`)
  throw new Error(err.message)
}

// --- sign in / out --------------------------------------------------------

/** Pull the account email out of the id_token without a network round trip. */
function emailFromIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') return ''
  try {
    const payload = idToken.split('.')[1]
    if (!payload) return ''
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(normalized), c => c.charCodeAt(0))
    const claims = JSON.parse(new TextDecoder().decode(bytes))
    return claims.email || ''
  } catch (err) {
    console.warn(`${LOG} Could not read the email claim from the id_token:`, err)
    return ''
  }
}

async function fetchAccountEmail(accessToken) {
  try {
    const res = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) {
      console.warn(`${LOG} userinfo lookup returned`, res.status)
      return ''
    }
    const data = await res.json()
    return data.email || ''
  } catch (err) {
    // Non-fatal: the integration works fine without knowing the address.
    console.warn(`${LOG} Could not resolve account email:`, err)
    return ''
  }
}

/**
 * Open the Google consent popup and complete the code exchange.
 * @returns {Promise<{access_token: string, refresh_token: string, expires_at: number, email: string}>}
 */
export async function signIn() {
  console.log(`${LOG} signIn() requested`)
  if (pendingSignIn) {
    console.log(`${LOG} Sign-in already in flight, reusing pending promise`)
    return pendingSignIn
  }

  pendingSignIn = (async () => {
    const clientId = getClientId()
    if (!clientId) throw new Error('No Google OAuth Client ID configured. Add one in the SYSTEM tab.')

    let verifier = ''
    let challenge = ''
    if (GIS_SUPPORTS_PKCE) {
      verifier = await generateCodeVerifier()
      challenge = await generateCodeChallenge(verifier)
      storeVerifier(verifier)
      console.log(`${LOG} PKCE verifier generated (%d chars) and stashed in sessionStorage`, verifier.length)
    } else {
      console.log(`${LOG} PKCE skipped — this GIS build does not forward code_challenge (see GIS_SUPPORTS_PKCE)`)
    }

    const client = await initGoogleAuth(clientId, challenge)

    const response = await new Promise((resolve, reject) => {
      client.callback = (resp) => {
        if (resp?.error) {
          reject(new Error(resp.error_description || resp.error))
          return
        }
        if (!resp?.code) {
          reject(new Error('Google did not return an authorization code.'))
          return
        }
        resolve(resp)
      }
      client.error_callback = (err) => {
        reject(new Error(err?.message || err?.type || 'Google sign-in was cancelled.'))
      }
      console.log(`${LOG} Opening Google consent popup (access_type=offline, prompt=consent)...`)
      client.requestCode()
    })

    const data = await exchangeCodeForTokens(response.code, readVerifier() || verifier, clientId)
    if (GIS_SUPPORTS_PKCE) {
      clearVerifier()
      console.log(`${LOG} PKCE verifier cleared from sessionStorage`)
    }

    const expiresIn = Number(data.expires_in) || 3600
    const tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || '',
      expires_at: Date.now() + expiresIn * 1000,
      email: emailFromIdToken(data.id_token),
      scope: data.scope || GOOGLE_SCOPES
    }
    if (!tokens.email) tokens.email = await fetchAccountEmail(tokens.access_token)
    storeTokens(tokens)
    setItem(EVER_CONNECTED_KEY, true)
    console.log(`${LOG} Signed in as %s, access token valid for %ds`, tokens.email || '(unknown)', expiresIn)

    scheduleBackgroundRefresh()
    emitChange()
    return tokens
  })()

  try {
    return await pendingSignIn
  } catch (err) {
    clearVerifier()
    console.error(`${LOG} signIn failed:`, err)
    throw err
  } finally {
    pendingSignIn = null
  }
}

/** Clear the stored tokens. Does not revoke consent on Google's side. */
export function signOut() {
  const had = !!getStoredTokens()
  clearTokens()
  clearVerifier()
  removeItem(EVER_CONNECTED_KEY)
  console.log(`${LOG} signOut() — cleared stored tokens (had tokens:`, had, ')')
  if (had) emitChange()
}

// --- refresh --------------------------------------------------------------

/**
 * Exchange the stored refresh token for a new access token.
 * @returns {Promise<string|null>} the new access token, or null on failure
 */
export async function refreshAccessToken() {
  if (pendingRefresh) {
    console.log(`${LOG} Refresh already in flight, reusing pending promise`)
    return pendingRefresh
  }

  const tokens = getStoredTokens()
  const clientId = getClientId()
  if (!tokens?.refresh_token) {
    console.warn(`${LOG} refreshAccessToken() — no refresh token stored`)
    return null
  }
  if (!clientId) {
    console.warn(`${LOG} refreshAccessToken() — no Client ID configured`)
    return null
  }

  pendingRefresh = (async () => {
    console.log(`${LOG} Refresh attempted`)
    const params = {
      refresh_token: tokens.refresh_token,
      client_id: clientId,
      grant_type: 'refresh_token'
    }
    const secret = getClientSecret()
    if (secret) params.client_secret = secret

    let result
    try {
      result = await postToTokenEndpoint(params)
    } catch (err) {
      // Offline or blocked: keep the refresh token, the next call retries.
      console.error(`${LOG} Refresh failed — network error:`, err)
      return null
    }

    const { ok, status, data, text } = result
    if (!ok || !data?.access_token) {
      const err = describeTokenError(status, data, text)
      console.error(`${LOG} Refresh failed (${status}): ${err.message}`)
      // 400/401 from the token endpoint means the grant itself is dead
      // (revoked at myaccount.google.com, expired, or client mismatch).
      if (status === 400 || status === 401) {
        clearTokens()
        emitChange()
        emitReauthRequired('revoked', 'Please reconnect to Google')
      }
      return null
    }

    const expiresIn = Number(data.expires_in) || 3600
    const next = {
      ...tokens,
      access_token: data.access_token,
      // Google usually omits refresh_token on renewal; keep the existing one.
      refresh_token: data.refresh_token || tokens.refresh_token,
      expires_at: Date.now() + expiresIn * 1000,
      scope: data.scope || tokens.scope
    }
    storeTokens(next)
    console.log(`${LOG} Refresh succeeded — new access token valid for %ds`, expiresIn)
    scheduleBackgroundRefresh()
    emitChange()
    return next.access_token
  })()

  try {
    return await pendingRefresh
  } finally {
    pendingRefresh = null
  }
}

/**
 * The single entry point every Google API call goes through: returns a token
 * that is good for at least the next five minutes, renewing it first if not.
 * @returns {Promise<string|null>}
 */
export async function getAccessToken() {
  const tokens = getStoredTokens()
  if (!tokens) {
    console.log(`${LOG} getAccessToken() — no stored tokens`)
    return null
  }

  const remaining = tokens.expires_at - Date.now()
  if (tokens.access_token && remaining > REFRESH_MARGIN_MS) {
    console.log(`${LOG} Token returned from cache (%d min remaining)`, Math.round(remaining / 60000))
    return tokens.access_token
  }

  if (!tokens.refresh_token) {
    // A v2.6 install always has one; this is a token stranded by a failed
    // exchange or a hand-edited store.
    console.warn(`${LOG} Access token is expiring and there is no refresh token — sign-in required`)
    clearTokens()
    emitChange()
    emitReauthRequired('no-refresh-token', 'Please reconnect to Google')
    return null
  }

  console.log(`${LOG} Access token expires in %ds — refreshing before use`, Math.round(remaining / 1000))
  return refreshAccessToken()
}

// --- proactive background refresh ----------------------------------------

function scheduleBackgroundRefresh() {
  stopBackgroundRefresh()
  const tokens = getStoredTokens()
  if (!tokens?.refresh_token) return

  // Wake up either ~55 minutes from now or just before this token expires,
  // whichever comes first, so it never goes stale mid-session.
  const untilExpiry = tokens.expires_at - Date.now() - REFRESH_MARGIN_MS
  const delay = Math.max(1000, Math.min(BACKGROUND_REFRESH_MS, untilExpiry))
  console.log(`${LOG} Background refresh scheduled in %d min`, Math.round(delay / 60000))
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    console.log(`${LOG} Background refresh timer fired`)
    refreshAccessToken().catch(err => console.error(`${LOG} Background refresh threw:`, err))
  }, delay)
}

/**
 * Arm the timer if a renewable session exists. Safe to call repeatedly — it
 * replaces any timer already pending. Used by App.jsx so a remount (React
 * StrictMode does one in development) re-arms what its cleanup tore down.
 */
export function ensureBackgroundRefresh() {
  if (!getStoredTokens()?.refresh_token) return
  scheduleBackgroundRefresh()
}

export function stopBackgroundRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
    console.log(`${LOG} Background refresh timer cleared`)
  }
}

/**
 * Called once on app boot. Migrates a v2.5.1 token, tops up an access token
 * that is about to expire, and arms the background refresh timer.
 *
 * @returns {Promise<{migrated: boolean, signedIn: boolean, needsSignIn: boolean, missingClientId: boolean}>}
 */
export async function bootstrapGoogleAuth() {
  const migrated = migrateLegacyToken()
  const clientId = getClientId()
  const tokens = getStoredTokens()
  const everConnected = !!getItem(EVER_CONNECTED_KEY)

  console.log(`${LOG} Bootstrap — clientId:%s tokens:%s refreshToken:%s migrated:%s`,
    !!clientId, !!tokens, !!tokens?.refresh_token, migrated)

  if (tokens?.refresh_token) {
    const remaining = tokens.expires_at - Date.now()
    if (remaining <= REFRESH_MARGIN_MS) {
      console.log(`${LOG} Bootstrap — access token expires in %ds, refreshing now`, Math.round(remaining / 1000))
      await refreshAccessToken()
    } else {
      console.log(`${LOG} Bootstrap — access token still good for %d min`, Math.round(remaining / 60000))
    }
    scheduleBackgroundRefresh()
  }

  // iOS Safari evicts a PWA's localStorage after a stretch of disuse. The app
  // must not look broken when it happens — just ask for one sign-in.
  const needsSignIn = !migrated && !!clientId && everConnected && !getStoredTokens()
  const missingClientId = !clientId && everConnected

  return { migrated, signedIn: isSignedIn(), needsSignIn, missingClientId }
}

// --- state ----------------------------------------------------------------

/** @returns {boolean} whether a usable Google session is stored. */
export function isSignedIn() {
  const tokens = getStoredTokens()
  if (!tokens) return false
  // A refresh token keeps the session alive even once the access token lapses.
  if (tokens.refresh_token) return true
  return !!tokens.access_token && Date.now() < tokens.expires_at
}

/** @returns {boolean} whether tokens renew silently (drives the SYSTEM badge). */
export function hasAutoRefresh() {
  return !!getStoredTokens()?.refresh_token
}

/** @returns {string} the connected account email, or '' if unknown/signed out. */
export function getAccountEmail() {
  if (!isSignedIn()) return ''
  return getStoredTokens()?.email || ''
}

/** @returns {number} epoch ms at which the current access token expires. */
export function getTokenExpiry() {
  return getStoredTokens()?.expires_at || 0
}

/**
 * Called from calendar.js / tasks.js after a 401. Under v2.6 that usually just
 * means a clock skew or a token revoked mid-flight, so try one refresh before
 * giving up on the session.
 */
export function handleUnauthorized(source = 'GoogleAuth') {
  console.warn(`[NeuroNote:${source}] 401 from Google — attempting a token refresh`)
  refreshAccessToken().then(token => {
    if (!token) {
      console.warn(`[NeuroNote:${source}] Refresh after 401 did not produce a token`)
    }
  }).catch(err => {
    console.error(`[NeuroNote:${source}] Refresh after 401 threw:`, err)
  })
}
