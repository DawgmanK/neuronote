// v2.5 — Outlook Calendar via Microsoft Graph. Mirrors services/calendar.js so
// the sync layer can swap providers without changing its call shape.
import { handleUnauthorized } from './microsoft-auth.js'
import { addMinutesToLocalDateTime, TIME_ZONE } from './calendar.js'

const EVENTS_ENDPOINT = 'https://graph.microsoft.com/v1.0/me/events'

/**
 * Create an event on the user's default Outlook calendar.
 * @param {object} params
 * @param {string} params.title
 * @param {string} [params.description]
 * @param {string} params.startDateTime naive local datetime, "YYYY-MM-DDTHH:MM:SS"
 * @param {number} [params.durationMinutes=30]
 * @param {string} params.accessToken Microsoft Graph bearer token
 * @param {string} [params.timeZone]
 * @returns {Promise<{success: boolean, eventId?: string, webLink?: string, error?: string, status?: number, needsReauth?: boolean}>}
 */
export async function createEvent({ title, description, startDateTime, durationMinutes = 30, accessToken, timeZone = TIME_ZONE }) {
  if (!accessToken) {
    console.error('[NeuroNote:Outlook] createEvent called without an access token')
    return { success: false, error: 'Not signed in to Microsoft.', needsReauth: true }
  }

  let start
  let end
  try {
    start = /T\d{2}:\d{2}:\d{2}$/.test(startDateTime) ? startDateTime : `${startDateTime}:00`
    end = addMinutesToLocalDateTime(start, Math.max(1, Number(durationMinutes) || 30))
  } catch (err) {
    console.error('[NeuroNote:Outlook] Failed to build event window:', err, { startDateTime, durationMinutes })
    return { success: false, error: err.message }
  }

  const body = {
    subject: title,
    body: { contentType: 'text', content: description || '' },
    start: { dateTime: start, timeZone },
    end: { dateTime: end, timeZone }
  }

  console.log('[NeuroNote:Outlook] POST %s', EVENTS_ENDPOINT, body)

  try {
    const res = await fetch(EVENTS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(body)
    })

    if (res.status === 401) {
      const text = await res.text()
      console.error('[NeuroNote:Outlook] 401 Unauthorized:', text)
      handleUnauthorized('Outlook')
      return { success: false, error: 'Microsoft session expired. Please reconnect.', status: 401, needsReauth: true }
    }

    if (!res.ok) {
      const text = await res.text()
      console.error('[NeuroNote:Outlook] Request failed:', res.status, text)
      let message = `Outlook Calendar error (${res.status})`
      try {
        const parsed = JSON.parse(text)
        if (parsed?.error?.message) message = parsed.error.message
      } catch {
        // Non-JSON error body; keep the status-based message.
      }
      return { success: false, error: message, status: res.status }
    }

    const data = await res.json()
    console.log('[NeuroNote:Outlook] Response:', { id: data.id, webLink: data.webLink, start: data.start, end: data.end })
    return { success: true, eventId: data.id, webLink: data.webLink }
  } catch (err) {
    console.error('[NeuroNote:Outlook] Network/unexpected error:', err)
    return { success: false, error: err.message || 'Network error reaching Outlook Calendar.', network: true }
  }
}
