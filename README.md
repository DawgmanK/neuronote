# NeuroNote

An AI-powered meeting note-taking app for sales professionals, consultants, and anyone who runs a lot of meetings and needs summaries, action items, and calendar integration — without the monthly SaaS fee.

## What it does

- 🎙️ Records meetings on your phone or laptop
- ✍️ Transcribes with speaker diarization (AssemblyAI)
- 🧠 Generates summaries, key points, action items, flashcards, and quizzes (OpenAI)
- 📅 Sends action items directly to Google Calendar or Outlook Calendar
- ✓ Sends tasks to Google Tasks or Microsoft To Do
- 🔄 Auto-refreshing sign-in — connect once, stay connected
- 💬 Ask NeuroNote — conversational Q&A across your entire meeting archive
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
- **OpenAI** (openai.com) — pay-as-you-go, ~$2-5/month typical use
- **AssemblyAI** (assemblyai.com) — $50 free credits at signup (~130 hrs)
- **Google Cloud OR Microsoft Azure** (optional — for Calendar/Tasks integration)

After deploying:
1. Open your app URL
2. Go to SYSTEM tab
3. Enter your OpenAI API key
4. Enter your AssemblyAI API key
5. (Optional) Set up Google or Microsoft OAuth Client ID for Calendar integration
6. Start recording

Detailed setup guides are in the `docs/` folder.

## Run it locally

```bash
npm install
npm run dev
```

Open http://localhost:5173. `npm run build` writes the production bundle to `dist/`.

Nothing needs configuring before the first run — the app reads no build-time environment variables, so there
is no `.env` file to fill in. Every key is entered in the SYSTEM tab. See `.env.example` for the details.

## Your data, your keys, your bill

- All API keys are stored in your browser's localStorage — never sent to any server
- Recordings, transcripts, and summaries stay on YOUR device
- API costs bill directly to YOUR OpenAI/AssemblyAI accounts
- The developer of this app has ZERO access to your data, keys, or usage

## Cost

Realistic real-world usage:
- 2-3 meetings per week: **~$2-5/month**
- Daily use with long meetings: **~$10-15/month**
- Compare to HyNote and similar: **$99/year to $30/month**

## Tech stack

- React + Vite
- AssemblyAI (transcription with speaker diarization)
- OpenAI GPT-4o (summaries, action items, Q&A)
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
