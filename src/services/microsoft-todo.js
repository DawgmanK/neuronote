// v2.5 — Microsoft To Do via Microsoft Graph. Mirrors services/tasks.js.
//
// Graph has no "@default" alias for To Do the way Google Tasks does, so the
// user's main list has to be looked up once and cached.
import { handleUnauthorized } from './microsoft-auth.js'
import { getItem, setItem, removeItem } from '../lib/storage.js'
import { TIME_ZONE } from './calendar.js'

const LISTS_ENDPOINT = 'https://graph.microsoft.com/v1.0/me/todo/lists'
const LIST_ID_KEY = 'microsoft:default-list-id'

/** To Do wants a 7-digit fractional second, e.g. "2026-08-30T00:00:00.0000000". */
export function buildDueDateTime(dueDate) {
  if (!dueDate) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error(`Invalid due date: ${dueDate}`)
  return `${dueDate}T00:00:00.0000000`
}

/** Forget the cached list id (after a 401, a sign-out, or a stale-id 404). */
export function clearCachedListId() {
  removeItem(LIST_ID_KEY)
}

/**
 * Resolve the id of the user's default "Tasks" list, caching it in localStorage.
 * @param {string} accessToken
 * @param {boolean} [forceRefresh] skip the cache after a stale-id failure
 * @returns {Promise<{success: boolean, listId?: string, error?: string, status?: number, needsReauth?: boolean, network?: boolean}>}
 */
export async function getDefaultListId(accessToken, forceRefresh = false) {
  if (!accessToken) {
    console.error('[NeuroNote:MSTodo] getDefaultListId called without an access token')
    return { success: false, error: 'Not signed in to Microsoft.', needsReauth: true }
  }

  const cached = getItem(LIST_ID_KEY)
  if (!forceRefresh && cached) {
    console.log('[NeuroNote:MSTodo] Using cached default list id:', cached)
    return { success: true, listId: cached }
  }

  console.log('[NeuroNote:MSTodo] GET %s', LISTS_ENDPOINT)
  try {
    const res = await fetch(LISTS_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` }
    })

    if (res.status === 401) {
      const text = await res.text()
      console.error('[NeuroNote:MSTodo] 401 Unauthorized:', text)
      handleUnauthorized('MSTodo')
      return { success: false, error: 'Microsoft session expired. Please reconnect.', status: 401, needsReauth: true }
    }

    if (!res.ok) {
      const text = await res.text()
      console.error('[NeuroNote:MSTodo] List lookup failed:', res.status, text)
      let message = `Microsoft To Do error (${res.status})`
      try {
        const parsed = JSON.parse(text)
        if (parsed?.error?.message) message = parsed.error.message
      } catch {
        // Non-JSON error body; keep the status-based message.
      }
      return { success: false, error: message, status: res.status }
    }

    const data = await res.json()
    const lists = Array.isArray(data.value) ? data.value : []
    console.log('[NeuroNote:MSTodo] Found %d task list(s)', lists.length)

    // "defaultList" is the built-in Tasks list; fall back to the first list on
    // accounts that somehow report none as well-known.
    const target = lists.find(l => l.wellknownListName === 'defaultList') || lists[0]
    if (!target?.id) {
      console.error('[NeuroNote:MSTodo] No usable task list on this account')
      return { success: false, error: 'No Microsoft To Do list found on this account.' }
    }

    console.log('[NeuroNote:MSTodo] Default list resolved:', target.displayName, target.id)
    setItem(LIST_ID_KEY, target.id)
    return { success: true, listId: target.id }
  } catch (err) {
    console.error('[NeuroNote:MSTodo] Network/unexpected error resolving list:', err)
    return { success: false, error: err.message || 'Network error reaching Microsoft To Do.', network: true }
  }
}

/**
 * Create a task on the user's default Microsoft To Do list.
 * @param {object} params
 * @param {string} params.title
 * @param {string} [params.notes]
 * @param {string} [params.dueDate] "YYYY-MM-DD"
 * @param {string} [params.dueTime] "HH:MM" — folded into notes; To Do due dates are date-only
 * @param {string} params.accessToken
 * @param {string} [params.timeZone]
 * @returns {Promise<{success: boolean, taskId?: string, webLink?: string, error?: string, status?: number, needsReauth?: boolean}>}
 */
export async function createTask({ title, notes, dueDate, dueTime, accessToken, timeZone = TIME_ZONE }) {
  if (!accessToken) {
    console.error('[NeuroNote:MSTodo] createTask called without an access token')
    return { success: false, error: 'Not signed in to Microsoft.', needsReauth: true }
  }

  const listResult = await getDefaultListId(accessToken)
  if (!listResult.success) return listResult

  let notesBody = notes || ''
  if (dueTime) {
    notesBody = notesBody ? `${notesBody}\n\nDue time: ${dueTime}` : `Due time: ${dueTime}`
  }

  const body = {
    title,
    body: { content: notesBody, contentType: 'text' }
  }
  try {
    const due = buildDueDateTime(dueDate)
    if (due) body.dueDateTime = { dateTime: due, timeZone }
  } catch (err) {
    console.error('[NeuroNote:MSTodo] Failed to build due date:', err, { dueDate })
    return { success: false, error: err.message }
  }

  const post = async (listId) => {
    const endpoint = `${LISTS_ENDPOINT}/${listId}/tasks`
    console.log('[NeuroNote:MSTodo] POST %s', endpoint, body)
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(body)
    })
  }

  try {
    let listId = listResult.listId
    let res = await post(listId)

    // A cached id can outlive the list itself; re-resolve once before failing.
    if (res.status === 404) {
      console.warn('[NeuroNote:MSTodo] Cached list id rejected (404) — re-resolving default list')
      const refreshed = await getDefaultListId(accessToken, true)
      if (!refreshed.success) return refreshed
      listId = refreshed.listId
      res = await post(listId)
    }

    if (res.status === 401) {
      const text = await res.text()
      console.error('[NeuroNote:MSTodo] 401 Unauthorized:', text)
      handleUnauthorized('MSTodo')
      return { success: false, error: 'Microsoft session expired. Please reconnect.', status: 401, needsReauth: true }
    }

    if (!res.ok) {
      const text = await res.text()
      console.error('[NeuroNote:MSTodo] Request failed:', res.status, text)
      let message = `Microsoft To Do error (${res.status})`
      try {
        const parsed = JSON.parse(text)
        if (parsed?.error?.message) message = parsed.error.message
      } catch {
        // Non-JSON error body; keep the status-based message.
      }
      return { success: false, error: message, status: res.status }
    }

    const data = await res.json()
    console.log('[NeuroNote:MSTodo] Response:', { id: data.id, title: data.title, dueDateTime: data.dueDateTime })
    return { success: true, taskId: data.id, webLink: 'https://to-do.office.com/tasks/' }
  } catch (err) {
    console.error('[NeuroNote:MSTodo] Network/unexpected error:', err)
    return { success: false, error: err.message || 'Network error reaching Microsoft To Do.', network: true }
  }
}
