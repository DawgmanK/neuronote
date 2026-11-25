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

// v2.9 — appended to the summary prompt, in both providers, when the
// recording was made on the Sales call tab. It adds a "sales" object to the
// same JSON the ordinary summary returns, so nothing else has to change.
export const SALES_CALL_RULES = `SALES CALL REPORT — this recording is a salesperson's own spoken report, dictated after visiting one or more customers or prospects in person. It is one person talking, not a conversation.

Add a "sales" object to the JSON, alongside "summary":
"sales": {
  "outcome": "One or two sentences on what came of the visit or visits overall.",
  "accounts": [{
    "customer": "The company or account, exactly as named",
    "contact": "The person or people met or mentioned there, or null",
    "relationship": "customer, prospect, or unknown",
    "notes": "What happened or was discussed with this account, in one to three sentences",
    "nextStep": "The next thing to do for this account, or null",
    "nextStepDate": "YYYY-MM-DD or null"
  }]
}

Rules for a sales call report:
- One entry in "accounts" for every company or account mentioned, in the order they came up. A report often covers several.
- "title" names the account and the purpose, for example "Country's North — Friday order check". When several accounts are covered, name the visit instead, for example "Tuesday customer follow-ups".
- The salesperson's own to-dos go in "actions" with owner "Me", each naming the account it belongs to.
- Company and people's names matter more than anything else here. Keep them exactly as said, and when speech recognition has clearly mangled one, use the most plausible reading rather than repeating the error.
- Use only what was said. Leave a field null, or the list empty, rather than guessing.`

// Extra guidance specific to flashcards/quiz — appended wherever a prompt
// produces study material.
export const STUDY_MATERIAL_STYLE_RULES = `Questions and answers must read as clean study material, not transcript excerpts.`
