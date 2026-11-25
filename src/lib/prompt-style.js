// v2.7.2 — the shared writing-style rule appended to every generation
// prompt in BOTH openai.js and gemini.js, so a transcript full of "um,
// so, like" doesn't come back out the other end of either provider.
// Defined once, here, so the wording can never drift between the two files.
export const WRITING_STYLE_RULES = `WRITING STYLE — applies to all generated text:
- Write in clean, professional prose as a skilled note-taker would.
- Remove all filler words and disfluencies: um, uh, ah, er, like (as filler), you know, I mean, sort of, kind of, basically, actually (as filler), and tag questions like "right?".
- Remove false starts, self-corrections, stammers, and repeated words.
- Do not quote the transcript verbatim. Synthesize meaning into your own clear sentences.
- Every sentence must be grammatically complete and well-formed.
- Preserve meaning and all specific facts, names, numbers, dates, and commitments exactly. Clean up HOW something was said, never WHAT was said.`

// Extra guidance specific to action items — appended alongside
// WRITING_STYLE_RULES wherever a prompt produces action-item text.
export const ACTION_ITEM_STYLE_RULES = `Each action item's "text" must read as a polished task statement.
  GOOD: "Send the updated pricing sheet to Mark by Friday."
  BAD:  "Um, so I need to like send Mark that, uh, pricing sheet thing by Friday."
Never carry transcript phrasing into action item text.`

// Extra guidance specific to flashcards/quiz — appended wherever a prompt
// produces study material.
export const STUDY_MATERIAL_STYLE_RULES = `Questions and answers must read as clean study material, not transcript excerpts.`
