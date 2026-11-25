# NeuroNote

An AI-powered meeting note-taking app for sales professionals, consultants, and anyone who runs a lot of meetings and needs summaries, action items, and calendar integration — without the monthly SaaS fee.

## What it does

- 🎙️ Records meetings on your phone or laptop, or takes an uploaded recording, photo, or text file
- ✍️ Transcribes with speaker diarization (AssemblyAI)
- 🧠 Generates summaries, key points, action items, flashcards, and quizzes — pick OpenAI (GPT-6) or Google Gemini (Gemini 4 Hydrogen, free tier) as your AI provider
- 📅 Sends action items directly to Google Calendar or Outlook Calendar
- ✓ Sends tasks to Google Tasks or Microsoft To Do
- 🔄 Auto-refreshing sign-in — connect once, stay connected
- 💬 Ask NeuroNote — one bar on the home screen searches your meetings and answers questions across all of them
- 🔁 Every note says whether AI wrote its summary, and can redo it in one tap
- 🤝 Sales call tab — dictate a call report after a visit and it is saved as a Google Doc in a Drive folder that Grok (or any assistant connected to your Drive) can read and log
- 🖼️ Photo capture with OCR for whiteboards/documents
- 🎯 Tap-to-correct with persistent learning dictionary
- 🥷 Discreet Mode — screensaver-style UI for sensitive recordings
- 📱 Works as a Progressive Web App (installable on iPhone/Android home screen)
- 🛡️ Bulletproof recording — survives tab switches, screen locks, browser crashes

## Deploy your own copy

Click the button below. Vercel will guide you through:
1. Creating a Vercel account (free)
2. Cloning this repo
3. Deploying to your own URL (e.g. `neuronote-yourname.vercel.app`)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/DawgmanK/neuronote)

**Note:** The button deploys straight from this repo. If you fork it, swap `DawgmanK` in the URL above for your own GitHub username so the button points at your copy.

## Setup — 15 minutes

You'll need free accounts at:
- **OpenAI** (openai.com) — pay-as-you-go, ~$2-5/month typical use — **or** **Google AI Studio** (aistudio.google.com) for Gemini, free with no credit card required
- **AssemblyAI** (assemblyai.com) — $50 free credits at signup (roughly 180–240 hours of audio at its current list prices)
- **Google Cloud OR Microsoft Azure** (optional — for Calendar/Tasks integration)

After deploying:
1. Open your app URL. The home screen shows a short "Finish setting up" checklist that walks through the steps below.
2. Open **Settings** (bottom right).
3. Under **AI**, pick OpenAI or Gemini, paste that provider's API key, and press **Save and test**. A green line confirms the key works.
4. Under **Transcripts**, paste your AssemblyAI key and press **Save and test**. A working key switches itself on.
5. (Optional) Under **Calendar**, set up a Google or Microsoft OAuth Client ID to send action items to your calendar or task list.
6. Tap the red button in the middle of the bottom bar and start recording.

Without any keys the app still records, using your browser's built-in speech recognition and a basic on-device
summary. Notes made that way say so, and can be redone with AI once a key is added.

Detailed setup guides are in the `docs/` folder.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. `npm run build` writes the production bundle to `dist/`.

Nothing needs configuring before the first run — the app reads no build-time environment variables, so there
is no `.env` file to fill in. Every key is entered in Settings. See `.env.example` for the details.

## Your data, your keys, your bill

- All API keys are stored in your browser's localStorage, and each one is only ever sent to the service it belongs to
- Recordings, transcripts, and summaries stay on YOUR device
- API costs bill directly to YOUR OpenAI/Gemini/AssemblyAI accounts
- The developer of this app has ZERO access to your data, keys, or usage

## Cost

Realistic real-world usage with OpenAI:
- 2-3 meetings per week: **~$2-5/month**
- Daily use with long meetings: **~$10-15/month**
- Compare to HyNote and similar: **$99/year to $30/month**

With Gemini instead of OpenAI, AI costs drop to **$0/month** — Google AI Studio's free tier covers summaries, flashcards, Q&A, and photo OCR at typical usage levels.

## Tech stack

- React + Vite
- AssemblyAI (transcription with speaker diarization)
- OpenAI GPT-6 **or** Google Gemini 4 Hydrogen (summaries, action items, flashcards, Q&A, photo OCR — your choice, set in Settings)
- Google Calendar/Tasks API OR Microsoft Graph API (with auto-refresh tokens)
- IndexedDB (persistent recording storage)
- Progressive Web App (PWA)

## Documentation

- [`docs/README.md`](docs/README.md) — index of the setup guides
- [`docs/TECHNICAL-REFERENCE.md`](docs/TECHNICAL-REFERENCE.md) — how each subsystem works, every storage key
  the app writes, and the reasoning behind the trickier decisions

## License

MIT — do whatever you want with it.

## Credits

Built with heavy assistance from Claude Code.
