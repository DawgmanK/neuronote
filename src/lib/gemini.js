// Google Gemini AI service — v2.7's alternative to openai.js.
//
// Mirrors openai.js function-for-function (same exported names, same
// parameters, same return shapes) so src/lib/ai-provider.js can dispatch to
// either module without any call site knowing which provider is active.
//
// Uses the Generative Language API (AI Studio): auth is an API key on the
// query string, not a header, and structured output is requested with
// responseMimeType + responseSchema instead of function calling.
import { getGeminiApiKey, addUsage } from './storage.js'
import { GEMINI_EMBEDDING_MODEL, GEMINI_EMBEDDING_DIMENSIONS, MODEL_COSTS } from './models.js'
import { todayISO } from './actionItems.js'
import { WRITING_STYLE_RULES, ACTION_ITEM_STYLE_RULES, STUDY_MATERIAL_STYLE_RULES, SALES_CALL_RULES } from './prompt-style.js'

// v2.8 — Gemini 4 Hydrogen (GA 2026-11-12, free tier). Was gemini-3.8-flash.
// Exported here as the single
// place to change it again in future.
export const GEMINI_MODEL = 'gemini-4-hydrogen'
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

const LOG = '[NeuroNote:Gemini]'

function getKey() {
  const key = getGeminiApiKey()
  if (!key) throw new Error('Gemini API key not configured. Add it in Settings.')
  return key
}

/** Turns a Gemini HTTP failure into the same kind of message openai.js throws. */
async function describeError(res) {
  let body = ''
  try { body = await res.text() } catch { /* ignore */ }
  if (res.status === 401 || res.status === 403) {
    return `Gemini API error (${res.status}): invalid or unauthorized API key`
  }
  if (res.status === 429) {
    return `Gemini API error (429): rate limit exceeded — try again shortly`
  }
  if (res.status === 400) {
    return `Gemini API error (400): malformed request — ${body.slice(0, 300)}`
  }
  return `Gemini API error (${res.status}): ${body.slice(0, 300)}`
}

/**
 * Low-level call to models/{model}:generateContent.
 * @param {string} model - Gemini model id.
 * @param {object} opts
 * @param {string} [opts.system] - system instruction text.
 * @param {Array} opts.contents - Gemini `contents` turns ({role, parts}).
 * @param {object} [opts.responseSchema] - structured-output schema.
 */
async function generateContent(model, { system, contents, responseSchema } = {}) {
  // v2.7.1 — the legacy sampling-control params (creativity/topP/topK) are
  // deprecated on the current API and no longer sent. The only
  // generationConfig fields left are the structured-output ones, and only
  // when a schema is requested.
  let generationConfig
  if (responseSchema) {
    generationConfig = {
      responseMimeType: 'application/json',
      responseSchema
    }
  }

  const requestBody = { contents }
  if (generationConfig) requestBody.generationConfig = generationConfig
  if (system) requestBody.systemInstruction = { parts: [{ text: system }] }

  console.log(`${LOG} API request:`, { model, turns: contents.length, systemPrompt: system?.slice(0, 100) })

  const res = await fetch(
    `${GEMINI_BASE_URL}/models/${model}:generateContent?key=${getKey()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    }
  )

  if (!res.ok) {
    const message = await describeError(res)
    console.error(`${LOG} API error:`, res.status, message)
    throw new Error(message)
  }

  const data = await res.json()
  const candidate = data.candidates?.[0]
  const content = candidate?.content?.parts?.map(p => p.text || '').join('') || ''
  const finishReason = candidate?.finishReason
  console.log(`${LOG} API response:`, { model, finishReason, tokens: data.usageMetadata, responseLength: content.length })
  console.log(`${LOG} Raw response (first 500 chars):`, content.slice(0, 500))

  if (finishReason === 'MAX_TOKENS') {
    console.warn(`${LOG} WARNING: Response was truncated (finishReason=MAX_TOKENS).`)
  }

  const totalTokens = data.usageMetadata?.totalTokenCount || 1000
  const cost = (MODEL_COSTS[model] || 0) * (totalTokens / 1000)
  addUsage(cost, model)
  return content
}

function parseJSON(text) {
  // Strip markdown code fences if present — Gemini usually skips these when
  // responseMimeType is set, but be defensive the way openai.js is.
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
  const jsonMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)
  if (jsonMatch) cleaned = jsonMatch[1]
  try {
    return JSON.parse(cleaned)
  } catch (e) {
    console.error(`${LOG} JSON parse failed. Raw text:`, text)
    console.error(`${LOG} Cleaned text:`, cleaned)
    throw new Error(`Failed to parse Gemini response as JSON: ${e.message}`)
  }
}

// ---------------------------------------------------------------------------
// generateSummary — same contract and prompt rules as openai.js.
// ---------------------------------------------------------------------------
const SUMMARY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    summary: {
      type: 'OBJECT',
      properties: {
        paragraph: { type: 'STRING' },
        bullets: { type: 'ARRAY', items: { type: 'STRING' } },
        actions: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              text: { type: 'STRING' },
              owner: { type: 'STRING' },
              dueDate: { type: 'STRING', nullable: true },
              dueTime: { type: 'STRING', nullable: true },
              suggestedType: { type: 'STRING' },
              duration: { type: 'NUMBER' }
            },
            required: ['text', 'owner', 'suggestedType', 'duration']
          }
        }
      },
      required: ['paragraph', 'bullets', 'actions']
    },
    decisions: { type: 'ARRAY', items: { type: 'STRING' } },
    followups: { type: 'ARRAY', items: { type: 'STRING' } },
    // v2.9 — only filled in for a sales call report; see SALES_CALL_RULES.
    sales: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        outcome: { type: 'STRING', nullable: true },
        accounts: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              customer: { type: 'STRING' },
              contact: { type: 'STRING', nullable: true },
              relationship: { type: 'STRING', nullable: true },
              notes: { type: 'STRING', nullable: true },
              nextStep: { type: 'STRING', nullable: true },
              nextStepDate: { type: 'STRING', nullable: true }
            },
            required: ['customer']
          }
        }
      }
    }
  },
  required: ['summary', 'decisions', 'followups']
}

// eslint-disable-next-line no-unused-vars -- `model` kept for signature parity with openai.js; Gemini has one model tier.
export async function generateSummary(transcript, model, options = {}) {
  const today = `${todayISO()} (${new Date().toLocaleDateString('en-US', { weekday: 'long' })})`
  const system = `You are a meeting analyst. Given a transcript, produce a structured JSON summary.

Today's date is: ${today}

Return a JSON object with exactly this shape:
{
  "title": "A specific 3-8 word title naming what the meeting was about, e.g. 'Acme renewal pricing review'. No quotation marks, no date, no trailing period.",
  "summary": {
    "paragraph": "An overview in complete, polished prose: what the meeting was about, what was concluded, and what happens next. 2-4 sentences for a short meeting, up to 8 for a long one.",
    "bullets": ["Complete sentence stating key point 1, with the specifics.", "Complete sentence stating key point 2, with the specifics.", "...up to 10 bullet points; more for a longer meeting, none when there is nothing to add beyond the action items"],
    "actions": [{
      "text": "Complete sentence describing the action",
      "owner": "Name of the person responsible, 'Me' for the speaker's own tasks, or 'Unknown'",
      "dueDate": "YYYY-MM-DD or null",
      "dueTime": "HH:MM in 24hr, or null",
      "suggestedType": "event or task",
      "duration": 30
    }]
  },
  "decisions": ["Complete sentence describing decision 1."],
  "followups": ["Complete sentence describing open question or next step."]
}

Rules:
- Write for someone who missed the meeting. They should finish reading knowing what actually happened, not merely which topics came up.
- Be specific. Keep the names, numbers, amounts, dates and reasons that matter. "Acme asked for a 10% discount on a two-year term" is useful; "Pricing was discussed" is not.
- Say each thing once. An item listed under "actions" must not be repeated under "bullets" or "followups". When a recording is mostly a list of things to do, put them in "actions" and keep "bullets" for context that is not a task, even if that leaves "bullets" empty.
- Scale the detail to the length of the transcript. A long meeting deserves a fuller overview and more key points; a one-minute recording needs only a sentence or two and may have a single bullet. Never pad.
- The transcript comes from speech recognition and may contain misheard words, missing punctuation, or wrongly split speakers. Work out the intended meaning from context and do not repeat obvious recognition errors.
- Speakers may be labelled "Speaker A", "Speaker 1" or "You". When someone's real name is clear from the conversation, use the name instead of the label.
- If the transcript is too short or too garbled to summarize, say so plainly in "paragraph" and return empty arrays rather than inventing content.
- Every string except "title" must be a complete, well-formed sentence — never a fragment or truncated text.
- "bullets" should be high-level SYNTHESIZED takeaways, NOT raw transcript excerpts. Rephrase in your own words.
- "actions" are ONLY concrete commitments, assignments, or tasks that someone explicitly agreed to do (e.g., "I will send the report by Friday"). Do NOT include rhetorical statements, opinions, wishes, or general commentary. If no real action items exist, return an empty array [].
- "decisions" are only explicit choices that were made. If none, return [].
- "followups" are only open questions and unresolved points that nobody has taken on. Anything with an owner belongs in "actions" instead. If none, return [].
- Write in professional, clear language. SYNTHESIZE the content — do not copy/paste transcript text.
- Return ONLY the JSON object. No markdown fences, no explanation, no commentary outside the JSON.

Action item field rules:
- "text": a complete, well-formed sentence describing the action.
- "owner": the name of the person responsible. When the speaker takes something on themselves ("I'll send it", "I need to call her"), use "Me", or their name if it is clear from the conversation. Use "Unknown" only when a task is assigned to nobody identifiable.
- "dueDate": resolve relative dates against today's date (${today}). "tomorrow" is the next calendar day, "Friday" is the next upcoming Friday, "end of month" is the last day of the current month, "next week" is 7 days from today. If no date is mentioned at all, use null.
- "dueTime": a 24-hour "HH:MM" time when a specific time is stated, otherwise null.
- "suggestedType": use "event" when the item mentions a meeting, call, sync, demo, or a scheduled time. Use "task" when the item is to send, email, follow up, prepare, review, or check with someone. When neither clearly applies, default to "task".
- "duration": event length in minutes. Default to 30, but use 60 when the word "meeting" appears in the item.

${WRITING_STYLE_RULES}

${ACTION_ITEM_STYLE_RULES}${options?.kind === 'sales-call' ? `\n\n${SALES_CALL_RULES}` : ''}`

  const content = await generateContent(GEMINI_MODEL, {
    system,
    contents: [{ role: 'user', parts: [{ text: `Summarize this meeting transcript:\n\n${transcript}` }] }],
    responseSchema: SUMMARY_SCHEMA
  })
  const parsed = parseJSON(content)
  console.log(`${LOG} Parsed summary:`, JSON.stringify(parsed, null, 2).slice(0, 1000))
  return parsed
}

// ---------------------------------------------------------------------------
// generateFlashcards
// ---------------------------------------------------------------------------
const FLASHCARDS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    flashcards: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { question: { type: 'STRING' }, answer: { type: 'STRING' } },
        required: ['question', 'answer']
      }
    },
    quiz: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          question: { type: 'STRING' },
          answer: { type: 'STRING' },
          explanation: { type: 'STRING' }
        },
        required: ['question', 'answer', 'explanation']
      }
    }
  },
  required: ['flashcards', 'quiz']
}

export async function generateFlashcards(transcript) {
  const content = await generateContent(GEMINI_MODEL, {
    system: `Given a meeting transcript, return a JSON object with two keys: flashcards (array of {question, answer} pairs covering key concepts), quiz (array of {question, answer, explanation} for self-testing). Every question and answer must be a complete, well-formed sentence.

${STUDY_MATERIAL_STYLE_RULES}

${WRITING_STYLE_RULES}`,
    contents: [{ role: 'user', parts: [{ text: transcript }] }],
    responseSchema: FLASHCARDS_SCHEMA
  })
  return parseJSON(content)
}

// ---------------------------------------------------------------------------
// detectActionItems — used by Live Action Items while recording.
// ---------------------------------------------------------------------------
const ACTION_ITEMS_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      action: { type: 'STRING' },
      owner: { type: 'STRING', nullable: true },
      due: { type: 'STRING', nullable: true }
    },
    required: ['action']
  }
}

export async function detectActionItems(partialTranscript) {
  const content = await generateContent(GEMINI_MODEL, {
    system: `Analyze this partial meeting transcript. Return ONLY a JSON array of NEW action items detected (commitments, promises, decisions with owners and due dates if mentioned). Format: [{action, owner, due}]. Return empty array if nothing new.

${WRITING_STYLE_RULES}

${ACTION_ITEM_STYLE_RULES}`,
    contents: [{ role: 'user', parts: [{ text: partialTranscript }] }],
    responseSchema: ACTION_ITEMS_SCHEMA
  })
  return parseJSON(content)
}

// ---------------------------------------------------------------------------
// extractImageText — photo OCR via Gemini's built-in vision.
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars -- `model` kept for signature parity with openai.js.
export async function extractImageText(base64Image, model) {
  const raw = base64Image.startsWith('data:') ? base64Image.split(',')[1] : base64Image
  const mimeMatch = /^data:(image\/[a-z0-9+.-]+);base64,/i.exec(base64Image)
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg'

  return await generateContent(GEMINI_MODEL, {
    system: 'Extract all text visible in this image. If it\'s a whiteboard, slide, or document, transcribe the content faithfully. If diagrams are present, describe them briefly. Return plain text, no markdown.',
    contents: [{
      role: 'user',
      parts: [
        { text: 'Extract text from this image:' },
        { inlineData: { mimeType, data: raw } }
      ]
    }]
  })
}

// ---------------------------------------------------------------------------
// generateEmbedding — used by Ask NeuroNote's semantic search index.
// ---------------------------------------------------------------------------
export async function generateEmbedding(text) {
  console.log(`${LOG} Embedding request:`, { model: GEMINI_EMBEDDING_MODEL, chars: text.length })
  const res = await fetch(
    `${GEMINI_BASE_URL}/models/${GEMINI_EMBEDDING_MODEL}:embedContent?key=${getKey()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${GEMINI_EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: GEMINI_EMBEDDING_DIMENSIONS
      })
    }
  )
  if (!res.ok) {
    const message = await describeError(res)
    console.error(`${LOG} Embedding API error:`, res.status, message)
    throw new Error(message)
  }
  const data = await res.json()
  addUsage(MODEL_COSTS[GEMINI_EMBEDDING_MODEL] || 0, GEMINI_EMBEDDING_MODEL)
  return data.embedding.values
}

// ---------------------------------------------------------------------------
// generateAnswer — Ask NeuroNote conversational Q&A over indexed notes.
// ---------------------------------------------------------------------------
export async function generateAnswer(question, contextChunks, conversationHistory = []) {
  const context = contextChunks.map((c, i) => `[Note ${i + 1}: ${c.noteTitle || 'Untitled'}]\n${c.text}`).join('\n\n---\n\n')

  const contents = [
    { role: 'user', parts: [{ text: `Context from meeting notes:\n\n${context}` }] },
    { role: 'model', parts: [{ text: 'Understood — I have the context from your notes and I\'m ready to answer questions about them.' }] },
    ...conversationHistory.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    })),
    { role: 'user', parts: [{ text: question }] }
  ]

  return await generateContent(GEMINI_MODEL, {
    system: `You are NeuroNote, an AI assistant with access to the user's meeting notes. Answer questions based on the provided context from their notes. Cite which notes your answer comes from using [Note X] references. Be concise and helpful.

${WRITING_STYLE_RULES}`,
    contents
  })
}

// ---------------------------------------------------------------------------
// gradeAnswer — used by the Flashcards quiz mode.
// ---------------------------------------------------------------------------
const GRADE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    correct: { type: 'BOOLEAN' },
    feedback: { type: 'STRING' }
  },
  required: ['correct', 'feedback']
}

export async function gradeAnswer(question, correctAnswer, userAnswer) {
  const content = await generateContent(GEMINI_MODEL, {
    system: `Grade this answer. Reply with JSON: {correct: boolean, feedback: string}. "feedback" must be a complete, well-formed sentence.

${WRITING_STYLE_RULES}`,
    contents: [{
      role: 'user',
      parts: [{ text: `Question: ${question}\nCorrect answer: ${correctAnswer}\nStudent answer: ${userAnswer}` }]
    }],
    responseSchema: GRADE_SCHEMA
  })
  return parseJSON(content)
}
