// Thin orchestration layer shared by the single-item dialog and the
// "Review & Add All" modal: resolve a token for the chosen provider, then call
// the matching calendar/task service.
//
// v2.1 shipped this as google-sync.js; v2.5 generalized it to Microsoft 365
// (Outlook Calendar + Microsoft To Do) alongside Google.
import { getAccessToken as getGoogleToken } from './google-auth.js'
import { getAccessToken as getMicrosoftToken } from './microsoft-auth.js'
import { createEvent as createGoogleEvent } from './calendar.js'
import { createTask as createGoogleTask } from './tasks.js'
import { createEvent as createOutlookEvent } from './outlook-calendar.js'
import { createTask as createMicrosoftTask } from './microsoft-todo.js'
import { toLocalDateTime, buildDetailBody } from '../lib/actionItems.js'

/** Where a created item lives when the API does not hand back a deep link. */
export const FALLBACK_LINKS = {
  google: { event: 'https://calendar.google.com/', task: 'https://tasks.google.com/' },
  microsoft: { event: 'https://outlook.office.com/calendar/', task: 'https://to-do.office.com/tasks/' }
}

/** Human-readable destination names, used in dialogs, toasts, and badges. */
export const SERVICE_LABELS = {
  google: { event: 'Google Calendar', task: 'Google Tasks', short: 'Google' },
  microsoft: { event: 'Outlook Calendar', task: 'Microsoft To Do', short: 'Microsoft' }
}

/** Short badge text for an item that has already been added. */
export function addedLabel(provider, type) {
  if (provider === 'microsoft') return type === 'event' ? 'Outlook' : 'To Do'
  return type === 'event' ? 'Calendar' : 'Tasks'
}

/**
 * @param {object} params
 * @param {'event'|'task'} params.type
 * @param {{title: string, date: string, time: string, duration: number}} params.draft
 * @param {object} [params.item] original action item (for owner/context)
 * @param {string} [params.noteTitle]
 * @param {'google'|'microsoft'} [params.provider='google']
 * @param {boolean} [params.allowInteractive=false] let Microsoft prompt
 *   interactively when a silent refresh is not enough. v2.5.1: that prompt is a
 *   full-page redirect, so it discards whatever is on screen — the default is
 *   now false and callers surface `needsReauth` instead.
 * @returns {Promise<{success: boolean, type: string, provider: string, id?: string, link?: string, error?: string, needsReauth?: boolean}>}
 */
export async function sendActionItem({ type, draft, item, noteTitle, provider = 'google', allowInteractive = false }) {
  const target = provider === 'microsoft' ? 'microsoft' : 'google'
  const body = buildDetailBody(item, noteTitle)
  const fallbackLink = FALLBACK_LINKS[target][type === 'event' ? 'event' : 'task']

  if (target === 'microsoft') {
    const accessToken = await getMicrosoftToken({ allowInteractive })
    if (!accessToken) {
      console.warn('[NeuroNote:MSAuth] sendActionItem blocked — no valid access token')
      return { success: false, type, provider: target, error: 'Microsoft session expired. Please reconnect.', needsReauth: true }
    }

    if (type === 'event') {
      const result = await createOutlookEvent({
        title: draft.title,
        description: body,
        startDateTime: toLocalDateTime(draft.date, draft.time),
        durationMinutes: draft.duration,
        accessToken
      })
      return { ...result, type: 'event', provider: target, id: result.eventId, link: result.webLink || fallbackLink }
    }

    const result = await createMicrosoftTask({
      title: draft.title,
      notes: body,
      dueDate: draft.date,
      dueTime: draft.time,
      accessToken
    })
    return { ...result, type: 'task', provider: target, id: result.taskId, link: result.webLink || fallbackLink }
  }

  // v2.6: this is async — it silently refreshes an expiring token first.
  const accessToken = await getGoogleToken()
  if (!accessToken) {
    console.warn('[NeuroNote:GoogleAuth] sendActionItem blocked — no valid access token')
    return { success: false, type, provider: target, error: 'Google session expired. Please reconnect.', needsReauth: true }
  }

  if (type === 'event') {
    const result = await createGoogleEvent({
      title: draft.title,
      description: body,
      startDateTime: toLocalDateTime(draft.date, draft.time),
      durationMinutes: draft.duration,
      accessToken
    })
    return { ...result, type: 'event', provider: target, id: result.eventId, link: result.htmlLink || fallbackLink }
  }

  const result = await createGoogleTask({
    title: draft.title,
    notes: body,
    dueDate: draft.date,
    dueTime: draft.time,
    accessToken
  })
  return { ...result, type: 'task', provider: target, id: result.taskId, link: result.htmlLink || fallbackLink }
}
