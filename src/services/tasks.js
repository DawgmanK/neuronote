// Google Tasks API v1 — create due-date reminders from action items.
import { handleUnauthorized } from './google-auth.js'

const TASKS_ENDPOINT = 'https://www.googleapis.com/tasks/v1/lists/@default/tasks'

// Google Tasks renders due dates as date-only; any time component is ignored,
// so a requested time is preserved in the notes body instead.
export function buildDue(dueDate) {
  if (!dueDate) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error(`Invalid due date: ${dueDate}`)
  return `${dueDate}T00:00:00.000Z`
}

/**
 * Create a task on the user's default task list.
 * @param {object} params
 * @param {string} params.title
 * @param {string} [params.notes]
 * @param {string} [params.dueDate] "YYYY-MM-DD"
 * @param {string} [params.dueTime] "HH:MM" — folded into notes, Tasks has no time field
 * @param {string} params.accessToken
 * @returns {Promise<{success: boolean, taskId?: string, htmlLink?: string, error?: string, status?: number, needsReauth?: boolean}>}
 */
export async function createTask({ title, notes, dueDate, dueTime, accessToken }) {
  if (!accessToken) {
    console.error('[NeuroNote:Tasks] createTask called without an access token')
    return { success: false, error: 'Not signed in to Google.', needsReauth: true }
  }

  let notesBody = notes || ''
  if (dueTime) {
    notesBody = notesBody ? `${notesBody}\n\nDue time: ${dueTime}` : `Due time: ${dueTime}`
  }

  const body = { title, notes: notesBody }
  try {
    const due = buildDue(dueDate)
    if (due) body.due = due
  } catch (err) {
    console.error('[NeuroNote:Tasks] Failed to build due date:', err, { dueDate })
    return { success: false, error: err.message }
  }

  console.log('[NeuroNote:Tasks] POST %s', TASKS_ENDPOINT, body)

  try {
    const res = await fetch(TASKS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(body)
    })

    if (res.status === 401) {
      const text = await res.text()
      console.error('[NeuroNote:Tasks] 401 Unauthorized:', text)
      handleUnauthorized('Tasks')
      return { success: false, error: 'Google session expired. Please reconnect.', status: 401, needsReauth: true }
    }

    if (!res.ok) {
      const text = await res.text()
      console.error('[NeuroNote:Tasks] Request failed:', res.status, text)
      let message = `Tasks API error (${res.status})`
      try {
        const parsed = JSON.parse(text)
        if (parsed?.error?.message) message = parsed.error.message
      } catch {
        // Non-JSON error body; keep the status-based message.
      }
      return { success: false, error: message, status: res.status }
    }

    const data = await res.json()
    console.log('[NeuroNote:Tasks] Response:', { id: data.id, title: data.title, due: data.due })
    return { success: true, taskId: data.id, htmlLink: 'https://tasks.google.com/' }
  } catch (err) {
    console.error('[NeuroNote:Tasks] Network/unexpected error:', err)
    return { success: false, error: err.message || 'Network error reaching Google Tasks.', network: true }
  }
}
