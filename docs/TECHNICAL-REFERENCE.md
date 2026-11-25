# NeuroNote — Technical Reference

Implementation notes for NeuroNote Meeting OS v2.9.1: how each subsystem works, every storage key it
writes, and the reasoning behind the trickier decisions. For installation and day-to-day use, start at the
[project README](../README.md).

AI-powered meeting note-taking app with discreet screensaver recording, background-safe recording, chunked live transcription, speaker diarization, live action items, flashcard generation, conversational Q&A across your entire note archive, one-tap push of action items to Google Calendar and Google Tasks or to Outlook Calendar and Microsoft To Do, and a tap-to-correct learning dictionary that teaches NeuroNote how your names are spelled. As of v2.6 both Google and Microsoft sign-ins persist for weeks and refresh themselves silently. As of v2.7 every AI feature can run on OpenAI or on Google Gemini — pick one in **Settings → AI**. v2.8 redesigned the interface around three destinations (Home, Record, Settings) — see [Black chrome redesign (v2.8)](#black-chrome-redesign-v28).

> **Names in older sections.** The version-by-version sections below were written as each release shipped. Where one still says ARCHIVE, CAPTURE, SESSION or SYSTEM, read Home, Record, the note view, and Settings.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## API Keys

The app works without any API keys using browser-native speech recognition and local extractive summarization. For full AI features:

### AI Provider — OpenAI or Gemini (v2.7)
- Go to **Settings → AI**
- Pick **OpenAI** or **Gemini**, paste that provider's key in the field below the picker, and press **Save and test**
- **Save and test** (v2.8) stores the key, then makes one free, read-only request to the provider (listing its models) and reports the result in plain words: the key works and the models NeuroNote uses are available, the key works but a model is missing from the account, the key could not be confirmed, or the key was rejected. With the field empty the same button re-tests the saved key. See `src/lib/key-test.js`.
- **OpenAI**: key starts with `sk-`. Enables GPT-6.1 Terra summaries (GPT-6.2 Sol in best-quality mode), GPT-6 Luna flashcards and live action items, photo OCR, and Ask NeuroNote Q&A (the `OPENAI_MODELS` constant in `src/lib/openai.js`; moved from the GPT-5.6 family in v2.8).
- **Gemini**: free key from [aistudio.google.com](https://aistudio.google.com), no credit card required. Enables the same feature set — summaries, flashcards, live action items, photo OCR, Ask NeuroNote Q&A — on `gemini-4-hydrogen` (the `GEMINI_MODEL` constant in `src/lib/gemini.js`; moved from `gemini-3.8-flash` in v2.8).
- Both keys are kept in localStorage at once, so switching the picker back and forth never asks you to re-enter a key.
- `src/lib/ai-provider.js` is the only place that reads the provider choice; every component imports the AI functions from there instead of from `openai.js`/`gemini.js` directly, so the two backends are interchangeable to the rest of the app.
- Embeddings are provider-specific (OpenAI `text-embedding-3-small` is 1536-dim, Gemini `gemini-embedding-2` is requested at 768-dim) — `vectorSearch.js` skips a note's embedding for Ask NeuroNote if it was indexed under the other provider, rather than scoring across mismatched dimensions. Re-saving a note re-indexes it under whichever provider is active. Gemini's previous embedding model, `text-embedding-004`, was shut down by Google in January 2026; v2.8 moved to `gemini-embedding-2`.

### AssemblyAI API Key (Optional)
- Go to **Settings → Transcripts**
- Paste your AssemblyAI API key and press **Save and test**
- A key that passes the test switches **Use AssemblyAI for transcripts** on by itself (v2.8); the switch is still there to turn it off
- Enables: High-accuracy transcription with speaker diarization ("Speaker A" / "Speaker B" labels)

### Choosing a calendar provider (v2.5)
- Go to **Settings → Calendar**
- Pick **Google**, **Microsoft**, **Both**, or **None** (default). The selector decides which credential
  sections are shown and which buttons appear on action items.
- Upgrading from v2.4 with a Google Client ID already saved selects **Google** automatically.

### Google OAuth Client ID (Optional, v2.1; persistent since v2.6)
- Go to **Settings → Calendar** -> **Google**
- Paste your OAuth 2.0 **Client ID**
- Get it from Google Cloud Console -> APIs & Services -> Credentials -> Create OAuth client ID -> **Web application**
- Add your app origin (e.g. `http://localhost:5173` and your Vercel URL) to **Authorized JavaScript origins** —
  v2.6 needs no new redirect URIs, the ones already registered work
- Enable the **Google Calendar API** and **Google Tasks API** for the same project
- On the OAuth consent screen, make sure these four scopes are listed: `calendar.events`, `tasks`,
  `userinfo.email`, `openid`
- Then press **Sign in with Google**. You stay signed in — see [Persistent Google sign-in](#persistent-google-sign-in-v26).
- **Client Secret** field: a "Web application" OAuth client is confidential as far as Google is concerned, so
  its token endpoint wants the secret even from a browser. If sign-in reports that it is required, copy it from
  the same Credentials page (Cloud Console → Credentials → your OAuth client → **Client secret**) and paste it
  here. It is stored in localStorage next to your OpenAI and AssemblyAI keys and is only ever posted to
  `oauth2.googleapis.com`.

### Microsoft Azure Client ID (Optional, v2.5)
- Go to **Settings → Calendar** -> **Microsoft 365**
- In the Azure portal open **Microsoft Entra ID -> App registrations -> New registration**
- Choose **Accounts in any organizational directory and personal Microsoft accounts** for the multi-tenant
  default, and add a **Single-page application** redirect URI for each origin you use
  (e.g. `http://localhost:5173` and your Vercel URL)
- Copy the **Application (client) ID** into the Azure Client ID field. No client secret is ever needed
- Leave **Tenant ID** as `common` unless your organization requires a specific directory
- Press **Sign in with Microsoft**. Scopes requested: `Calendars.ReadWrite`, `Tasks.ReadWrite`, `User.Read`,
  `offline_access`
- MSAL caches a refresh token and renews the connection silently. Since v2.6 the Google side does the same —
  see [Persistent Google sign-in](#persistent-google-sign-in-v26).

## Features

- **Home** — every meeting, grouped by date, each showing its summary and open action items. One bar filters the list as you type and hands the same words to Ask NeuroNote. New installs see a setup checklist.
- **Record** — the centre button. Record with live waveform, live transcript, live action items, photo capture, Speakers and Discreet switches, and a live chunk-transcription strip; or upload a recording, a photo, or a text file.
- **Note view** — opens over Home, from the list and automatically when a recording finishes. Summary, speaker-labeled transcript, Study (flashcards with 3D flip and AI-graded quizzes), and the unedited capture, with Share, delete, and Redo summary.
- **Settings** — four sections: **AI** (provider, key, extras), **Transcripts** (AssemblyAI, learned corrections), **Calendar** (Google and/or Microsoft 365), **About** (what is in use, estimated spend, where data lives).
- **Persistent sign-in (v2.6)** — Google now uses the authorization code flow with PKCE, so one sign-in lasts for weeks and tokens refresh silently in the background, exactly as MSAL already did for Microsoft

### Black chrome redesign (v2.8)

v2.8 replaced the cream-and-red "typewriter" theme and the four-tab layout.

**Theme.** Dark-only: black surfaces, chrome (silver gradient) for the logo, headings and large numerals, and three neon accents that each have exactly one job, so colour always means something. The tokens live in the `@theme` block of `src/index.css`.

| Token | Colour | Used for |
|-------|--------|----------|
| `accent` | neon blue | anything interactive or AI: links, focus, the active tab, Ask, the waveform |
| `rec` | neon red | recording and destructive actions, and nothing else |
| `ok` | neon green | done, saved, connected, verified |

The component classes (`.glass`, `.sheet`, `.btn-primary`, `.btn-ghost`, `.pill`, `.chrome-ring`, `.chrome-text`, `.section-label`) are declared inside `@layer components`, so a Tailwind utility on the same element always wins. Left unlayered they silently override utilities.

**Three destinations.** Home, Record and Settings. The tab ids are unchanged from v2.7 (`archive`, `capture`, `system`) because the recorder and the Microsoft sign-in redirect navigate by those names; `normalizeTab()` in `App.jsx` maps anything else, including the retired `session`, to Home. The Session tab is gone: a note opens in an overlay over Home.

**Home.** One field does two jobs: typing filters the list (title, transcript, summary, tags), and Enter or **Ask AI** hands the same words to Ask NeuroNote, which opens with the question already running. The meetings an answer drew on are tappable. A first-run checklist (AI key, transcription key, first recording) shows until it is complete or dismissed (`neuronote:setup-checklist-dismissed`).

**Deleting a note** is immediate, with an **Undo** in the toast for eight seconds. A deleted note's search index is ignored by Ask straight away and pruned at the next launch, so Undo restores the note whole.

**Uploads.** `classifyUpload()` in `Capture.jsx` decides what a file is from both its MIME type and its name, because browsers report `.mp4` and `.webm` as `video/*` even when they hold only audio (NeuroNote's own recordings are `.webm`). Recordings go to AssemblyAI, pictures to OCR, text is read directly, and anything else is refused. A refused or failed upload shows the reason and saves nothing. PDFs are not supported: the app has no PDF reader.

### How a summary was made, and redoing it (v2.8.2)

`src/lib/summarize.js` is the one place a transcript becomes a summary. `summarizeTranscript()` never throws; it reports whether the AI wrote the summary or the on-device sentence-picker (`extractive.js`) stood in, and why. Every note records the outcome:

| Field | Values |
|-------|--------|
| `summarySource` | `ai` or `local` |
| `summaryModel` | display name of the model that wrote it, or `null` |
| `summaryReason` | `null` on success, `no-key` when no AI key was saved, otherwise a short description of the failure |
| `transcriptSource` | `assemblyai`, `browser` (Web Speech), `photo`, or `file` |
| `titleAuto` | `true` while the title is the generated one; cleared when the user renames the note |

A note whose summary is a stand-in shows a notice at the top of its Summary tab with **Summarize with AI** (or **Try again** after a failure). Every AI summary has a **Redo summary** link under it. Redo keeps ticked and already-sent action items whose wording is unchanged and asks first when a note has any, never overwrites a title the user typed, re-indexes the note for Ask, and generates study cards if the note had none. Notes saved before v2.8.2 carry none of these fields and show no notice, but can still be redone.

The AI also writes the note's title. The summary prompt is kept word-for-word identical between `openai.js` and `gemini.js`; it asks for specifics, scales detail to the length of the transcript, works around speech-recognition errors, lists each item once, and marks the speaker's own tasks as owned by "Me". Relative due dates are resolved against the **local** date and weekday (the UTC date is already the next day on a US evening).

### Sales call reports and the Grok handoff folder (v2.9)

NeuroNote keeps everything in the browser, so nothing outside the device can read a note. The handoff folder is the way out: a note is saved as a Google Doc in one Drive folder, and an assistant with a Google Drive connector reads it from its own side. "Send to Grok" never talks to Grok.

**Sales call tab.** Record has three tabs: Meeting, Sales call and Upload. Sales call records exactly as Meeting does; `startRecording({ kind: 'sales-call' })` marks the recording, and the kind is saved with the crash-recovery copy so a recovered recording keeps it. It is meant for a spoken report dictated after an in-person visit, not for recording the visit itself.

**The report.** For a sales call, `SALES_CALL_RULES` (in `prompt-style.js`, appended in both providers) adds a `sales` object to the summary JSON: an overall `outcome` and one entry in `accounts` per company mentioned, each with `customer`, `contact`, `relationship`, `notes`, `nextStep` and `nextStepDate`. The note is saved with `kind: 'sales-call'` and the `sales` object, shows an Accounts card, and gets no study cards.

**The folder.** `services/google-drive.js` finds or creates a folder named "NeuroNote Sales Calls" and uploads each report as HTML converted to a Google Doc (`buildCallDocument()` in `lib/grok-handoff.js` writes it: a short header, then Summary, Outcome, Accounts, Key points, Action items, Decisions, Open questions and Transcript). The folder's id is cached; if the folder has been deleted the upload's 404 triggers one fresh lookup and retry. A saved note records `handoff: { sentAt, fileId, link, folderLink }`.

**Permission.** The scope is `drive.file`, the narrowest Drive scope: the app can see only files it created. It is requested only once the handoff is switched on (`getRequestedScopes()` in `google-auth.js`), so other users' consent screens are unchanged. The Google Drive API must be enabled in the same Cloud project as the OAuth client; the app says so if it is not.

**Sending.** With "Send sales calls to the folder" on (Settings → Calendar → Grok handoff), a sales call report is sent as soon as it is saved. Every note also has a Send to Grok button, shown on sales calls always and on other notes once the handoff is in use. Settings has a "Send a test document" button for checking the setup without recording.

**Email instead of Drive.** The no-setup route. With an address saved under Settings → Calendar → Grok handoff (`settings.handoffEmail`, kept in this browser only), each note gets an "Email to Grok" button, and a finished sales call report offers one in a toast. NeuroNote has no server and cannot send mail, so the button is a `mailto:` link built by `buildMailtoLink()`: it opens the device's mail app with the address, subject and a plain-text report filled in, and the user presses Send. The report is kept to about 6,000 characters by shortening the transcript, which comes last. A note records `handoffEmail: { openedAt, to }` when the mail app is opened; whether the message was sent is not something the app can know.

### Microsoft 365: Outlook Calendar + Microsoft To Do (v2.5)

Settings → Calendar (called **Calendar & Tasks Integration** on the SYSTEM tab until v2.8) replaces v2.1's "Google Integration" card. A four-way
selector — **Google / Microsoft / Both / None** — decides which provider sections are shown and where action
items go; the choice is stored in `neuronote:integration:provider`.

Microsoft sign-in uses **MSAL.js** (`@azure/msal-browser`) with a **redirect flow** against
`https://login.microsoftonline.com/{tenantId}` and a `localStorage` token cache. MSAL is loaded on demand, so
Google-only users never download it. Because the app requests `offline_access`, MSAL refreshes access tokens
silently in the background — a connected Microsoft account keeps working past the one-hour token lifetime
without a reconnect prompt.

**v2.5.1 — redirect instead of popup.** v2.5 used `loginPopup()`, which MSAL refuses to open whenever it
detects the current window is itself a popup, failing with
`BrowserAuthError: block_nested_popups`. Sign-in now navigates the whole page:

1. **Sign In with Microsoft** calls `loginRedirect()`; the tab it was started from is saved to
   `neuronote:microsoft:return-tab` and the browser leaves for `login.microsoftonline.com`.
2. Microsoft redirects back to the app origin (`http://localhost:5173` in dev) with the authorization code in
   the URL fragment.
3. On boot, `App` awaits `handleMicrosoftRedirect()`, which calls MSAL's `handleRedirectPromise()` to exchange
   the code for tokens, resolves the address via Graph `/me`, clears the fragment from the URL, and reopens
   Settings on the section the sign-in started from, with a "Connected to Microsoft 365" toast.

First paint is only gated on MSAL when the URL actually carries a redirect response, so an ordinary cold start
never waits on the lazy MSAL chunk. Every step logs under the `[NeuroNote:MSAuth]` prefix.

The interactive token fallback changed with it: `acquireTokenSilent()` is still tried first, but the fallback is
now `acquireTokenRedirect()`. Because that navigates away and would discard whatever is on screen, it is
**opt-in** (`getAccessToken({ allowInteractive: true })`) and off by default. The Add-to-service dialog and
**Review & Add All** therefore no longer prompt mid-flight — an expired session surfaces as a *"reconnect to
Microsoft"* toast, and the user reconnects from Settings, where a full-page redirect costs nothing.

Events are created with `POST /me/events` on Microsoft Graph. Tasks go to Microsoft To Do: the app resolves the
list whose `wellknownListName` is `defaultList`, caches its id in `neuronote:microsoft:default-list-id`, and
posts to `/me/todo/lists/{listId}/tasks`. Like Google Tasks, To Do due dates are date-only, so a chosen time is
preserved in the task body as `Due time: HH:MM`.

**With both providers connected**, the action-item row still shows only two buttons (**+ Calendar** and **+ Task list** since v2.8; **📅 Event** and **✓ Task** before). The
confirmation dialog gains a *Send to* switch at the top (Google Calendar / Outlook Calendar), so the row never
gets cluttered with four buttons. **Send all to calendar** (labelled **Review & Add All** before v2.8) gains a *Send events/tasks to* toggle at the top of the
modal: pick once, and the whole batch goes to that service.

### Google Calendar + Tasks (v2.1)

Every extracted action item carries an owner, a resolved due date/time, a suggested type (`event` or `task`), and a duration. In the note's Summary tab each item shows two buttons — **+ Calendar** and **+ Task list** (**📅 Event** and **✓ Task** before v2.8) — with nothing pre-selected. With no calendar service chosen the buttons are replaced by a line pointing to Settings → Calendar. Tapping one opens a confirmation dialog with an editable title, date, time, and (for events) duration. After a successful create the buttons are replaced by an **✓ Added to Calendar / Tasks** badge linking to the item in Google.

**Send all to calendar** opens a batch modal: one editable row per item with date and time pickers and an Event/Task toggle pre-set to the AI's suggestion. "Add All" creates them in sequence with a live progress toast.

Google Tasks stores dates only, so any time you set is preserved in the task notes as `Due time: HH:MM`. Calendar events are created on your primary calendar in the `America/New_York` timezone.

### Persistent Google sign-in (v2.6)

v2.1-v2.5.1 signed in with `google.accounts.oauth2.initTokenClient()` — the implicit flow. It hands back a
one-hour access token and nothing else, so the app forgot you every hour, and an iOS Safari PWA that had its
localStorage evicted forgot you sooner than that.

v2.6 uses `initCodeClient()`: the **authorization code flow with PKCE**, which is what MSAL has been doing for
Microsoft since v2.5.

1. The popup runs with `access_type: 'offline'` and `prompt: 'consent'`. Both are required: without them
   Google issues no refresh token at all.
2. The returned authorization code is POSTed once to `https://oauth2.googleapis.com/token` with
   `redirect_uri: 'postmessage'` — GIS popup mode relays the code through Google's own postMessage bridge, so
   that literal string is what the code is minted against. No new redirect URI has to be registered.
3. Google returns an `access_token` (~1 hour), a **`refresh_token`** (good until you revoke it), and an
   `id_token` whose `email` claim names the connected account.
4. All of it lands in `neuronote:google:tokens` as
   `{ access_token, refresh_token, expires_at, email, scope }`.

**About PKCE (v2.6.1).** v2.6.0 sent a `code_challenge` through `initCodeClient()` and a `code_verifier` on the
exchange. GIS's `CodeClientConfig` is a fixed allowlist and silently drops anything it does not recognise,
`code_challenge` included — so the code reached the token endpoint with no challenge bound to it and the
verifier matched nothing, which Google answers with `invalid_grant: Bad Request`. The verifier and challenge
helpers are still in `google-auth.js` behind the `GIS_SUPPORTS_PKCE` flag and switch back on in one line if GIS
ever forwards the parameters. **The persistent session does not depend on PKCE:** what keeps you signed in is
the refresh token, and the authorization code flow issues that either way. PKCE would stand in for the client
secret on a *public* OAuth client, but Google treats a "Web application" client as confidential and asks for
the secret regardless — which is why Settings → Calendar has that field.

The exchange also makes **exactly one attempt**. An authorization code is single-use, so a retry can only ever
come back `invalid_grant` and would bury the error that actually mattered; whatever Google says the first time
is logged raw and shown to you.

From then on nothing asks you to sign in again:

- **`getAccessToken()`** is the single door every Calendar and Tasks call goes through. More than five minutes
  of life left → the cached token is returned. Less → it silently refreshes first and returns the new one.
- **On app start**, if the stored token is already inside that five-minute window it refreshes immediately, and
  either way a `setTimeout` is armed to refresh again ~55 minutes later so a long session never goes stale.
  The timer is cleared on unmount and on sign-out.
- **If the refresh token is revoked** (at [myaccount.google.com/permissions](https://myaccount.google.com/permissions))
  Google answers 400/401, the app clears its Google tokens and raises a small
  "Please reconnect to Google" toast with a Sign In button. Nothing crashes, and no other tab is disturbed.
- **If iOS Safari clears localStorage**, the same non-blocking toast appears. If the Client ID went with it,
  Settings → Calendar shows a prominent "Google Client ID needed" panel instead.
- **Upgrading from v2.1-v2.5.1**: the old `neuronote:google:token` cannot be upgraded in place (it has no
  refresh token), so it is dropped on first load and you get one toast — "Google sign-in has been improved.
  Please sign in once more to activate auto-refresh." One sign-in later, you are done.

When Google is connected, Settings → Calendar shows **Stays signed in automatically** under the account email.

Every token operation logs under `[NeuroNote:GoogleAuth]` — refresh attempted, refresh succeeded, refresh
failed, token served from cache, and so on.

> If a sign-in ever completes without turning on the auto-refresh badge, Google declined to issue a refresh
> token. That happens when the account has already consented before. Revoke NeuroNote at
> [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and sign in again — Google only
> issues a refresh token on a fresh consent, which is exactly why `prompt: 'consent'` is set.

### Bulletproof Recording (v2.3)

The recorder used to live inside the CAPTURE component. Navigating to ARCHIVE mid-meeting unmounted that component and orphaned the audio chunks in memory — one real 70-minute recording was lost that way. In v2.3 the recorder lives in `src/contexts/RecordingContext.jsx`, mounted above the tab switcher in `App.jsx`, so tabs mount and unmount freely while the recording keeps running.

**Recording survives navigation.** Start a recording on Record, switch to Home or Settings — the MediaRecorder, the elapsed timer, the segment queue, and the Web Speech live transcript all keep going. Come back to Record and the elapsed time is continuous, because it never stopped.

**Always-visible banner.** While a recording is active, a floating banner sits below the status bar on every tab: a pulsing red dot and `Recording — 12:34`, ticking every second. Tap it to jump back to Record; tap the **×** to stop from wherever you are (with a confirm).

**Confirm on tab switch.** Tapping a different tab mid-recording raises a three-way prompt — **Keep recording** (default; switches tabs, recording continues), **Stop recording first** (stops, saves, then switches), and **Cancel**. The default is the safe one, so a mis-tap can never cost you a meeting. Going back to Record itself never prompts.

**Auto-save to IndexedDB every 30 seconds.** `src/lib/recording-store.js` mirrors the accumulated audio chunks into IndexedDB (via `idb-keyval`) under `neuronote:recording:in-progress:<sessionId>`, along with `startTime`, `elapsedSeconds`, `chunkCount`, and `sessionId`. IndexedDB rather than localStorage: Blobs survive intact, and the quota is hundreds of MB against localStorage's ~5 MB — a 70-minute Opus recording is roughly 35 MB. It also flushes on `pagehide`/`visibilitychange`.

On the next launch, any leftover in-progress recording raises a recovery prompt — *"You have an unsaved recording from 12 minutes ago (43 minutes long). Recover?"* — with **Recover** (transcribes the saved audio and turns it into a note), **Discard** (deletes it), and **Later** (leaves it in IndexedDB for next time).

**The audio outlives a failed transcription (v2.8.3).** Recovery needs AssemblyAI. If it is not configured, the request fails, or no speech comes back, recovery stops with a message and the recording stays in IndexedDB to be offered again at the next launch. The same holds on a normal Stop: when AssemblyAI was meant to transcribe the meeting and could not, the note is built from the rough Web Speech transcript and the audio is kept for recovery. Before v2.8.3 both paths saved a note and deleted the audio, which in recovery's case meant a note containing only an error sentence.

**The record button never gets stuck.** Every exit from a recording — normal stop, discard, or a failed start — runs the same teardown: the MediaRecorder is stopped and its reference nulled, `mediaStream.getTracks().forEach(t => t.stop())` releases the microphone, both intervals are cleared, the chunk buffers are emptied, and `recordingState` returns to `'idle'`. Each step logs under `[NeuroNote:Recording]`, so DevTools shows the full cleanup sequence. A failed `startRecording()` (permission revoked, mic held by another app) shows a toast and force-resets the same way — no app restart needed.

### Chunked Transcription (v2.3)

A 70-minute meeting used to be uploaded in one piece after Stop, so the wait scaled with the meeting: 10+ minutes of spinner. Now `src/lib/segmented-transcription.js` transcribes the meeting *while it is still being recorded*.

- Every 5 minutes the accumulated chunks are cut into a segment and sent to AssemblyAI in the background. Recording never pauses; new audio goes into the next segment.
- Only the first chunk MediaRecorder emits carries the container header, so every later segment is rebuilt as `[header, ...its own chunks]` — a mid-stream slice without that prefix is a run of clusters no decoder will open.
- Each segment tracks `{segmentId, startTimeOffset, audioBlob, transcript, utterances, status, retryCount}` with status `pending → uploading → transcribing → complete | failed`, and segments are combined strictly in index order.
- A failed segment is retried up to 3 times. If it still fails, its minutes appear in the final transcript as `[Transcription failed for minutes 25-30]` and everything else is kept — one bad chunk never takes down the transcript.
- On Stop: the final partial segment is sent, any outstanding segments are awaited, the transcripts are combined, and the summary runs. The wait is ~15-30 seconds whether the meeting ran 5 minutes or 2 hours. Progress toasts walk through *Finalizing recording... → Transcribing final segment... → Generating summary... → Done. Opening your note…*

**Live progress strip.** Below the record button, each segment shows as a chip — `[✓ 0-5min] [✓ 5-10min] [⟳ 10-15min] [🔴 recording 21:34]` — so the transcription is visibly happening rather than something you hope is happening.

**Speakers switch.** Under the record button on the Record screen (called Speaker Detection before v2.8). **ON** (default) sends `speaker_labels: true` for full diarization; **OFF** is faster with no speaker labels. The choice persists in localStorage at `neuronote:recording:diarization`. Diarization needs at least ~30 seconds of audio to be reliable, so a final tail shorter than that is transcribed without speaker labels rather than failing outright.

Two limits worth knowing: AssemblyAI assigns speaker labels per request, so "Speaker A" in one segment is not guaranteed to be the same person as "Speaker A" in the next — the labels are kept exactly as returned rather than guessed at. And chunked transcription only engages when an AssemblyAI key is saved and **Use AssemblyAI** is on; without it, recording still works and falls back to the Web Speech transcript exactly as in v2.2.

### Discreet Mode (v2.4)

For customer meetings and business calls where an obvious recording UI is the wrong thing to have face-up on the table, Discreet Mode hides the app behind what looks like a phone screensaver: a solid black screen with one dim ball drifting across it. No timer, no red dot, no text, no buttons.

**The ball is the entire status display.**

| Ball | Meaning |
|------|---------|
| Bouncing | Recording |
| Frozen in place | Paused |
| No ball / normal UI | Not recording |

**Gestures** (screensaver only). The screen is split into vertical thirds; the middle third is deliberately inert so a stray tap does nothing.

| Gesture | Action |
|---------|--------|
| Double-tap middle-**left** | Pause / resume — the ball freezes or resumes from where it stopped |
| Double-tap middle-**right** | Leave discreet mode; the recording keeps running in the normal UI |
| **Triple-tap** anywhere | Emergency exit: leaves discreet mode *and* stops the recording |

Confirmation is deliberately silent — the ball brightens for 200ms and that is all. A text popup would defeat the point.

Tap detection is hand-rolled from `Date.now()` deltas on `touchend` rather than the browser's `dblclick`, which is unreliable on mobile Safari. A double-tap waits 300ms before acting so a third tap still on its way can claim the gesture instead — otherwise every triple-tap would fire a pause first.

**Turning it on.** The **Discreet** switch sits next to **Speakers** on the Record screen and persists at `neuronote:recording:discreet`. The first time it is switched on, a one-time legal notice appears covering one-party vs. all-party consent states; acknowledging it stores `neuronote:discreet-disclaimer-acknowledged`. Because the toggle survives across sessions, tapping Record with it armed asks *"Discreet Mode is ON — screen will hide recording. Continue?"* first, so a toggle left on last week is never a surprise.

While the screensaver is up, the v2.3 recording banner is suppressed on every tab — a "Recording" badge anywhere would undo the whole feature.

**Staying alive.** The screensaver requests a screen Wake Lock so the phone does not lock mid-meeting, re-acquiring it after the page is backgrounded, and falling back silently where the API is unavailable (some iOS versions). A tiny invisible DOM write every 30 seconds keeps mobile Safari from throttling the page, since a throttled page is a throttled MediaRecorder. The ball itself animates on `requestAnimationFrame` — never `setInterval` — so the browser suspends it whenever the screen is off, and position lives in a ref so a 60fps animation costs zero React re-renders.

**Nothing underneath changes.** The recorder, five-minute chunk cutting, IndexedDB auto-save, and diarization all live in `RecordingContext` and are unaware the overlay exists. If the app dies mid-meeting while discreet, recovery behaves exactly as in v2.3 — except the prompt deliberately appears in the **normal** UI, never behind the screensaver, so the user can see what happened.

### Tap-to-Correct with a Learned Dictionary (v2.2)

Speech-to-text mangles proper nouns. Fix one once and NeuroNote never gets it wrong again.

**Correcting a word**
- **Mobile:** long-press (~500ms) any word in a transcript, summary, key point, action item, flashcard, quiz question/option, or speaker name.
- **Desktop:** right-click the word.
- **Keyboard:** Tab to the word and press Enter.

A popup shows the misheard word struck through with a field for the correct spelling, plus a **Remember this correction** checkbox (checked by default). Enter saves, Escape cancels. Dragging before the timer fires cancels the long-press, so normal text selection still works, and punctuation attached to a word (`Smyth,`) never lands in the popup.

Saving runs one find-and-replace across the whole session — transcript, speaker names, summary paragraph, key points, action items and owners, decisions, follow-ups, flashcards, and quiz items — then writes the session back to localStorage and reports what changed: `Fixed "Smyth" → "Smith" (13 places)`. Nothing is re-sent to the AI: regenerating a summary to fix one spelling would burn API credits for no reason. The **Unedited** tab (called **Original** before v2.8) deliberately keeps the raw, uncorrected capture.

Replacement is whole-word and case-preserving: `smyth → smith`, `Smyth → Smith`, `SMYTH → SMITH`, while `Smythson` is left alone. A correct spelling with internal capitals (`AssemblyAI`, `iPhone`) is always inserted verbatim.

**Applied to every future recording**
1. Before transcription, the correct spellings are sent to AssemblyAI as `keyterms_prompt` (v2.8.1; phrases of up to 6 words, capped at 200 words in total), so the model is steered toward them up front. This replaced `word_boost` / `boost_param`, which the current models treat as legacy and answer by routing the request to the older model. Key terms add about $0.05 per audio hour, and are only sent when there is at least one learned correction.
2. After transcription, the dictionary runs as a cleanup pass over the returned text and over each speaker's utterance. The Web Speech fallback and text-file uploads get the same cleanup pass.

**Managing the dictionary** — **Settings → Transcripts → Words to always fix** lists every entry (`wrong → right`, with a use count), lets you delete one with **×**, pre-load a correction with **Add a word** before it ever comes up, or wipe the list with **Remove all** (which asks first). Entries live at `neuronote:corrections` in localStorage.

### Mobile Touch Targets (v2.2.1)

Every control in the mobile UI is at least 44x44px — Apple's HIG minimum — and the session header and bottom nav respect the iOS safe areas.

- The session detail **Back** arrow is a 48x48 target and sits below the status bar / dynamic island (`padding-top: max(1rem, env(safe-area-inset-top))` on the overlay header).
- The main header's height follows the status bar / notch, and so does everything measured from it: `--safe-top` and `--header-h` in `src/index.css` are the single source, used by the header, the page content's top padding (`--header-h` + 22px) and the recording banner. Before this, content started at a fixed 72px and the top of each tab (the Record tab's Meeting / Sales call / Upload switch) sat under the header on iPhones.
- The bottom nav pads itself with `env(safe-area-inset-bottom)` so the tabs clear the home-indicator gesture area; the bottom-sheet dialogs do the same.
- Small controls — action-item checkboxes, the Event/Task pills, sub-tab pills, the delete icon on Home's cards, the learned-corrections delete x, the settings switches, and the CorrectionPopup Save/Cancel — keep their painted size and gain a padded hit box (`.tap-target` / `.tap-target-lg` in `src/index.css`).
- `index.html` ships `viewport-fit=cover`, which is what makes `env(safe-area-inset-*)` resolve on iOS.

## AI Models

| Feature | Model | Cost |
|---------|-------|------|
| Summaries & OCR | GPT-6.1 Terra (default) | ~$0.20/session (v2.7 estimate, not re-measured for GPT-6) |
| Flagship Mode | GPT-6.2 Sol | ~$0.27/session (v2.7 estimate, not re-measured for GPT-6) |
| Flashcards & Live Actions | GPT-6 Luna | ~$0.02/min (v2.7 estimate, not re-measured for GPT-6) |
| Embeddings | text-embedding-3-small | ~$0.02/1M tokens |
| Everything, with Gemini as the provider | Gemini 4 Hydrogen (`gemini-4-hydrogen`); embeddings on `gemini-embedding-2` | On Google's free tier at the time of writing |
| Transcription | AssemblyAI STT 3.7 (`assemblyai-stt-3-7`, falling back to `universal-2` for languages it does not cover) | ~$0.21/hr list price, +$0.02/hr with speaker labels, +$0.05/hr with key terms |

Best-quality mode (called Flagship Mode before v2.8) is meant for one sitting. Since v2.8.3 it is switched off on a fresh launch; a `sessionStorage` marker (`neuronote:session-started`) keeps it on through a reload or a sign-in redirect. Before that it was saved with the other settings and stayed on indefinitely.

The spend figure in Settings → About is an estimate built from list prices and the requests this browser has made; the provider dashboards hold the real bill.

## Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Or connect your GitHub repo to [vercel.com](https://vercel.com) for automatic deploys.

## Deploy to Netlify

```bash
npm run build
# Upload the `dist` folder to Netlify, or:
npx netlify-cli deploy --prod --dir=dist
```

## Tech Stack

- React 19 + Vite 8
- Tailwind CSS v4
- Framer Motion
- Zustand (available for state management)
- MSAL.js (`@azure/msal-browser`) for Microsoft 365 sign-in, lazy-loaded
- PWA with offline shell (vite-plugin-pwa)
- Notes and settings in localStorage (namespaced as `neuronote:*`); in-progress recording audio in IndexedDB via `idb-keyval`

## PWA

The app is installable as a Progressive Web App. On mobile, use "Add to Home Screen" for a native-like experience. The service worker caches the app shell for offline access.

## localStorage Keys

| Key | Content |
|-----|---------|
| `neuronote:notes` | All saved notes |
| `neuronote:settings` | App settings |
| `neuronote:apikey:openai` | OpenAI API key |
| `neuronote:gemini:apikey` | Gemini API key (v2.7) — plain string, not JSON-wrapped like the keys above |
| `neuronote:ai:provider` | Selected AI provider: `openai` (default) or `gemini` (v2.7) |
| `neuronote:apikey:assemblyai` | AssemblyAI API key |
| `neuronote:embeddings` | Vector embeddings for Q&A |
| `neuronote:usage` | API usage tracking |
| `neuronote:ai:status:openai`, `neuronote:ai:status:gemini` | Outcome of the most recent AI request per provider, shown as the status line in Settings (v2.7.2) |
| `neuronote:setup-checklist-dismissed` | Set when the first-run checklist on Home is closed (v2.8) |
| `neuronote:google:drive-wanted` | Set once the Grok handoff is switched on, so the next Google sign-in also asks for the `drive.file` scope (v2.9) |
| `neuronote:handoff:folder` | Cached id and link of the "NeuroNote Sales Calls" Drive folder (v2.9) |
| `neuronote:google:clientid` | Google OAuth Client ID |
| `neuronote:google:tokens` | Google access token, refresh token, `expires_at`, account email (v2.6) |
| `neuronote:google:clientsecret` | Optional Google client secret, only if your OAuth client demands one (v2.6) |
| `neuronote:google:everconnected` | Set once Google has been connected, so a cleared store can be told apart from a fresh install (v2.6) |
| `neuronote:google:token` | *Removed in v2.6.* The v2.1-v2.5.1 implicit-flow token; deleted on first v2.6 load |
| `neuronote:integration:provider` | Calendar/tasks provider choice: `google`, `microsoft`, `both`, `none` (v2.5) |
| `neuronote:microsoft:clientid` | Azure app registration (client) ID (v2.5) |
| `neuronote:microsoft:tenantid` | Azure tenant ID, `common` by default (v2.5) |
| `neuronote:microsoft:account` | Connected Microsoft account mirror for first-paint status (v2.5) |
| `neuronote:microsoft:default-list-id` | Cached Microsoft To Do default list id (v2.5) |
| `neuronote:microsoft:return-tab` | Tab to reopen after the Microsoft sign-in redirect; consumed on return (v2.5.1) |
| `msal.*` / `<clientId>.*` | MSAL's own token cache, written by `@azure/msal-browser` (v2.5) |
| `neuronote:corrections` | Learned spelling corrections (v2.2) |
| `neuronote:recording:diarization` | Speaker Detection toggle state (v2.3) |
| `neuronote:recording:discreet` | Discreet Mode toggle state (v2.4) |
| `neuronote:discreet-disclaimer-acknowledged` | Set once the v2.4 legal notice has been read (v2.4) |

## sessionStorage Keys

| Key | Content |
|-----|---------|
| `neuronote:google:pkce_verifier` | PKCE `code_verifier`, held only between opening the Google popup and exchanging the code. Unused while `GIS_SUPPORTS_PKCE` is false (v2.6) |
| `neuronote:settings-section` | Which Settings section is open, so a Microsoft sign-in redirect lands back on it (v2.8) |
| `neuronote:session-started` | Marks a browser tab that has already launched the app; its absence means a fresh launch, which resets best-quality mode (v2.8.3) |

## IndexedDB Keys

Database `neuronote`, object store `recordings` (v2.3).

| Key | Content |
|-----|---------|
| `neuronote:recording:in-progress:<sessionId>` | Audio chunks + metadata for a recording still in progress |
| `neuronote:recording:in-progress:index` | List of session IDs with recoverable audio |
