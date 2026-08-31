// Google Calendar API v3 — create timed events from action items.
import { handleUnauthorized } from './google-auth.js'

const CALENDAR_ENDPOINT = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

export const TIME_ZONE = 'America/New_York'

// Adds minutes to a naive local datetime string ("YYYY-MM-DDTHH:MM:SS") without
// letting the browser's own timezone shift the wall-clock value — the timeZone
// field on the request is what Google uses to resolve it.
export function addMinutesToLocalDateTime(localDateTime, minutes) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(localDateTime)
  if (!match) throw new Error(`Invalid start datetime: ${localDateTime}`)
  const [, y, mo, d, h, mi, s] = match
  const base = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0))
  const shifted = new Date(base + minutes * 60 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
}

/**
 * Create a calendar event on the user's primary calendar.
 * @param {object} params
 * @param {string} params.title
 * @param {string} [params.description]
 * @param {string} params.startDateTime naive local datetime, "YYYY-MM-DDTHH:MM:SS"
 * @param {number} [params.durationMinutes=30]
 * @param {string} params.accessToken
 * @param {string} [params.timeZone]
 * @returns {Promise<{success: boolean, eventId?: string, htmlLink?: string, error?: string, status?: number, needsReauth?: boolean}>}
 */
export async function createEvent({ title, description, startDateTime, durationMinutes = 30, accessToken, timeZone = TIME_ZONE }) {
  if (!accessToken) {
    console.error('[NeuroNote:Calendar] createEvent called without an access token')
    return { success: false, error: 'Not signed in to Google.', needsReauth: true }
  }

  let start
  let end
  try {
    start = /T\d{2}:\d{2}:\d{2}$/.test(startDateTime) ? startDateTime : `${startDateTime}:00`
    end = addMinutesToLocalDateTime(start, Math.max(1, Number(durationMinutes) || 30))
  } catch (err) {
    console.error('[NeuroNote:Calendar] Failed to build event window:', err, { startDateTime, durationMinutes })
    return { success: false, error: err.message }
  }

  const body = {
    summary: title,
    description: description || '',
    start: { dateTime: start, timeZone },
    end: { dateTime: end, timeZone },
    reminders: { useDefault: true }
  }

  console.log('[NeuroNote:Calendar] POST %s', CALENDAR_ENDPOINT, body)

  try {
    const res = await fetch(CALENDAR_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`
      },
      body: JSON.stringify(body)
    })

    if (res.status === 401) {
      const text = await res.text()
      console.error('[NeuroNote:Calendar] 401 Unauthorized:', text)
      handleUnauthorized('Calendar')
      return { success: false, error: 'Google session expired. Please reconnect.', status: 401, needsReauth: true }
    }

    if (!res.ok) {
      const text = await res.text()
      console.error('[NeuroNote:Calendar] Request failed:', res.status, text)
      let message = `Calendar API error (${res.status})`
      try {
        const parsed = JSON.parse(text)
        if (parsed?.error?.message) message = parsed.error.message
      } catch {
        // Non-JSON error body; keep the status-based message.
      }
      return { success: false, error: message, status: res.status }
    }

    const data = await res.json()
    console.log('[NeuroNote:Calendar] Response:', { id: data.id, htmlLink: data.htmlLink, start: data.start, end: data.end })
    return { success: true, eventId: data.id, htmlLink: data.htmlLink }
  } catch (err) {
    console.error('[NeuroNote:Calendar] Network/unexpected error:', err)
    return { success: false, error: err.message || 'Network error reaching Google Calendar.', network: true }
  }
}
