import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

async function callGeminiOnce(
  opts: {
    system: string;
    user: string;
    tool?: { name: string; description: string; parameters: unknown };
  },
  signal: AbortSignal,
) {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const body: Record<string, unknown> = {
    model: DEFAULT_MODEL,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
  };

  if (opts.tool) {
    body.tools = [
      {
        type: "function",
        function: {
          name: opts.tool.name,
          description: opts.tool.description,
          parameters: opts.tool.parameters,
        },
      },
    ];
    body.tool_choice = { type: "function", function: { name: opts.tool.name } };
  }

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 429) throw new Error("RATE_LIMIT");
  if (res.status === 402) throw new Error("CREDITS");
  if (!res.ok) {
    const t = await res.text();
    console.error("AI gateway error", res.status, t);
    throw new Error("AI_ERROR");
  }

  const data = await res.json();
  const choice = data.choices?.[0]?.message;
  if (opts.tool) {
    const args = choice?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("NO_TOOL_RESPONSE");
    return JSON.parse(args);
  }
  return choice?.content ?? "";
}

async function callGemini(opts: {
  system: string;
  user: string;
  tool?: { name: string; description: string; parameters: unknown };
}) {
  // Single retry with a per-attempt timeout — protects against transient
  // "fetch failed" / upstream timeout errors that otherwise blank the screen.
  const ATTEMPTS = 2;
  const TIMEOUT_MS = 45_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      return await callGeminiOnce(opts, ac.signal);
    } catch (e) {
      lastErr = e;
      const msg = (e as Error)?.message ?? "";
      // Don't retry user-actionable errors
      if (msg === "RATE_LIMIT" || msg === "CREDITS") throw e;
      console.warn(`Gemini call failed (attempt ${attempt + 1}/${ATTEMPTS})`, msg);
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("AI_ERROR");
}

/* ============================================================
 * STAGE 1 — Verse examples for the target word
 * ============================================================ */
const versesSchema = {
  type: "object",
  properties: {
    verses: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          arabic: { type: "string", description: "The verse text in Arabic with full tashkeel" },
          reference: { type: "string", description: "Surah:Ayah reference, e.g. 2:255" },
          translation: { type: "string", description: "Concise English translation" },
        },
        required: ["arabic", "reference", "translation"],
        additionalProperties: false,
      },
    },
  },
  required: ["verses"],
  additionalProperties: false,
};

export const generateVerseExamples = createServerFn({ method: "POST" })
  .inputValidator(z.object({ arabic: z.string(), meaning: z.string() }))
  .handler(async ({ data }) => {
    return (await callGemini({
      system:
        "You return real Quranic verses (not invented) where a target Arabic word appears. Use full tashkeel. Be accurate with surah:ayah references.",
      user: `Target word: ${data.arabic} (${data.meaning}). Return 3-4 short Quranic verses (or excerpts of long verses) where this exact word — or a clearly recognizable form of it — appears. Provide the Arabic, the surah:ayah reference, and a concise English translation.`,
      tool: {
        name: "return_verses",
        description: "Return Quranic verses containing the target word",
        parameters: versesSchema,
      },
    })) as { verses: { arabic: string; reference: string; translation: string }[] };
  });

/* ============================================================
 * STAGE 2 — Deck-wide cloze with Arabic drag tokens (k+1 distractor)
 * ============================================================ */
const deckClozeSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          arabic_word: { type: "string", description: "The exact target Arabic word from the deck (with tashkeel)" },
          sentence_before: { type: "string", description: "Arabic text that comes before the blank (with tashkeel)" },
          sentence_after: { type: "string", description: "Arabic text that comes after the blank (with tashkeel)" },
          translation: { type: "string", description: "English translation with the target shown as ___" },
        },
        required: ["arabic_word", "sentence_before", "sentence_after", "translation"],
        additionalProperties: false,
      },
    },
    distractor: {
      type: "string",
      description: "One extra plausible Arabic word that does NOT belong to any sentence (same register, with tashkeel)",
    },
  },
  required: ["items", "distractor"],
  additionalProperties: false,
};

export const generateDeckCloze = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      words: z.array(z.object({ arabic: z.string(), meaning: z.string() })).min(1).max(20),
    }),
  )
  .handler(async ({ data }) => {
    const list = data.words.map((w, i) => `${i + 1}. ${w.arabic} — ${w.meaning}`).join("\n");
    return (await callGemini({
      system:
        "You write classical/Quranic-register Arabic sentences for a vocabulary app. Use full tashkeel. Keep sentences short (5-10 words). The blank in each sentence must clearly require the assigned target word — context should disambiguate it.",
      user: `Deck words:\n${list}\n\nFor EACH word above, write one short Arabic sentence in Quranic register where that exact word appears. Return the sentence as two parts: text BEFORE the blank and text AFTER the blank (do NOT include the target word in either part). Then provide ONE additional plausible Arabic distractor word (same register, with tashkeel) that does NOT fit any of the sentences — this is for a drag-and-drop exercise where the user must pick the right word for each blank.`,
      tool: {
        name: "return_deck_cloze",
        description: "Deck-wide cloze items + 1 distractor",
        parameters: deckClozeSchema,
      },
    })) as {
      items: { arabic_word: string; sentence_before: string; sentence_after: string; translation: string }[];
      distractor: string;
    };
  });

/* ============================================================
 * STAGE 3 — Quranic-themed dialogue covering the whole deck
 * ============================================================ */
const dialogueSchema = {
  type: "object",
  properties: {
    topic: { type: "string", description: "Brief English summary of the Quranic theme being discussed" },
    exchanges: {
      type: "array",
      minItems: 6,
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          speaker: { type: "string", enum: ["A", "B"] },
          arabic: { type: "string", description: "Arabic line with full tashkeel; deck words appear in their exact form" },
          translation: { type: "string" },
        },
        required: ["speaker", "arabic", "translation"],
        additionalProperties: false,
      },
    },
    pause_after_index: { type: "number", description: "0-based index of a Speaker A line after which the user picks Speaker B's reply" },
    choice_options_arabic: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: { type: "string", description: "Arabic candidate reply (with tashkeel)" },
    },
    choice_options_translation: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: { type: "string", description: "English gloss of the matching Arabic option" },
    },
    correct_choice_index: { type: "number" },
    questions: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["meaning", "role"], description: "meaning = what the word means; role = function/role of the word in the verse/sentence" },
          target_word: { type: "string", description: "The deck word the question is about (Arabic, with tashkeel)" },
          question: { type: "string", description: "English question" },
          options: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 4 },
          correct_index: { type: "number" },
        },
        required: ["kind", "target_word", "question", "options", "correct_index"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "topic",
    "exchanges",
    "pause_after_index",
    "choice_options_arabic",
    "choice_options_translation",
    "correct_choice_index",
    "questions",
  ],
  additionalProperties: false,
};

export const generateDeckDialogue = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      words: z.array(z.object({ arabic: z.string(), meaning: z.string() })).min(1).max(20),
      deckName: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const list = data.words.map((w) => `${w.arabic} (${w.meaning})`).join(", ");
    return (await callGemini({
      system:
        "You write short Arabic dialogues set in a Quranic/Islamic discussion context (e.g. discussing a surah's meaning, a tafsir question, prayer, divine attributes). Use classical register with full tashkeel. The dialogue must NOT be everyday small talk.",
      user: `Deck${data.deckName ? ` (${data.deckName})` : ""} words: ${list}.

Compose a short dialogue (8-10 exchanges) between Speaker A and Speaker B that:
1) Stays within Quranic / Islamic-knowledge context (e.g. discussing a verse, an attribute of God, a concept like guidance, mercy, the path).
2) Naturally uses EVERY deck word above at least once. Use the EXACT Arabic form given.
3) Picks ONE Speaker A line where Speaker B's reply is non-obvious; mark its 0-based index as pause_after_index.
4) Provides 3 plausible Arabic reply options (with tashkeel) for that pause point, plus an English gloss for each, and the index of the correct one.
5) Generates 2-4 multiple choice questions in English about the dialogue:
   - At least one of kind="meaning" (what does the word mean here)
   - At least one of kind="role" (what role/function the word plays in the sentence/verse — e.g. "subject", "emphatic object pronoun", "marks the day of judgment", "divine attribute of mercy", etc.)
   - Each MCQ has 3-4 options; pick the index of the correct one.`,
      tool: {
        name: "return_dialogue",
        description: "Deck-wide Quranic dialogue + MCQs",
        parameters: dialogueSchema,
      },
    })) as {
      topic: string;
      exchanges: { speaker: "A" | "B"; arabic: string; translation: string }[];
      pause_after_index: number;
      choice_options_arabic: string[];
      choice_options_translation: string[];
      correct_choice_index: number;
      questions: {
        kind: "meaning" | "role";
        target_word: string;
        question: string;
        options: string[];
        correct_index: number;
      }[];
    };
  });

/* ============================================================
 * STAGE 4 — Spot the misuse: 2 sentences, one uses a deck word wrongly
 * ============================================================ */
const misuseSchema = {
  type: "object",
  properties: {
    target_word: { type: "string", description: "The deck word being tested (Arabic, with tashkeel)" },
    target_meaning: { type: "string" },
    sentences: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: {
        type: "object",
        properties: {
          arabic: { type: "string", description: "Original Arabic sentence (NOT a Quranic verse) with full tashkeel" },
          translation: { type: "string" },
          is_correct: { type: "boolean", description: "true if the target word is used correctly here, false if misused" },
        },
        required: ["arabic", "translation", "is_correct"],
        additionalProperties: false,
      },
    },
    issue: {
      type: "string",
      description: "Plain-English explanation of WHY the incorrect sentence misuses the word (semantic, grammatical, or contextual mistake).",
    },
  },
  required: ["target_word", "target_meaning", "sentences", "issue"],
  additionalProperties: false,
};

export const generateMisusePair = createServerFn({ method: "POST" })
  .inputValidator(z.object({ arabic: z.string(), meaning: z.string() }))
  .handler(async ({ data }) => {
    return (await callGemini({
      system:
        "You craft minimal pairs of original (non-Quranic) Arabic sentences for a vocabulary mastery exercise. Use full tashkeel. The misuse should be subtle but real — wrong semantic fit, wrong collocation, wrong grammatical role, or wrong register.",
      user: `Target word: ${data.arabic} (${data.meaning}).

Write exactly 2 short Arabic sentences (5-10 words each, NOT direct Quranic verses) that BOTH use this exact word. Exactly ONE must use the word correctly; the other must misuse it in a clear but not silly way. Randomize which one is correct. Provide an English translation for each, mark which is correct, and explain the issue with the incorrect one in 1-2 plain-English sentences.`,
      tool: {
        name: "return_misuse",
        description: "Return a correct/incorrect sentence pair",
        parameters: misuseSchema,
      },
    })) as {
      target_word: string;
      target_meaning: string;
      sentences: { arabic: string; translation: string; is_correct: boolean }[];
      issue: string;
    };
  });

const misuseGradeSchema = {
  type: "object",
  properties: {
    grade: { type: "string", enum: ["strong", "adequate", "weak"] },
    feedback: { type: "string" },
  },
  required: ["grade", "feedback"],
  additionalProperties: false,
};

export const gradeMisuseExplanation = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      targetWord: z.string(),
      targetMeaning: z.string(),
      incorrectSentence: z.string(),
      groundTruthIssue: z.string(),
      userExplanation: z.string(),
      pickedCorrectSentence: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    return (await callGemini({
      system:
        "You are a strict Arabic grammar and semantics grader. Be honest and demanding. Vague or generic explanations should be 'weak'. Only mark 'strong' when the user clearly identifies the actual issue.",
      user: `Target word: ${data.targetWord} (${data.targetMeaning}).
Incorrect sentence: ${data.incorrectSentence}
Real issue: ${data.groundTruthIssue}
The user ${data.pickedCorrectSentence ? "CORRECTLY identified the misused sentence" : "FAILED to identify which sentence misused the word"}.
User's explanation: "${data.userExplanation}"

Grade strictly:
- "strong": user picked the right sentence AND their explanation matches the real issue substantively.
- "adequate": user picked the right sentence and gave a partially correct or vague but related explanation.
- "weak": user picked the wrong sentence, OR their explanation is off-topic / generic / wrong.

Feedback: 2-3 sentences, specific.`,
      tool: { name: "return_grade", description: "Strict grade", parameters: misuseGradeSchema },
    })) as { grade: "strong" | "adequate" | "weak"; feedback: string };
  });

/* ============================================================
 * STAGE 5 — Arabic conversation, user replies must use deck words
 * ============================================================ */
const convoTurnSchema = {
  type: "object",
  properties: {
    arabic: { type: "string", description: "AI's next Arabic line (with tashkeel)" },
    translation: { type: "string", description: "English gloss" },
    expected_word: {
      type: "string",
      description: "The deck word the user is expected to use in their reply (Arabic, with tashkeel)",
    },
    prompt_hint: {
      type: "string",
      description: "Short English hint to the user about the kind of reply expected",
    },
    is_final: { type: "boolean", description: "True if this is the closing line of the conversation" },
  },
  required: ["arabic", "translation", "expected_word", "prompt_hint", "is_final"],
  additionalProperties: false,
};

export const generateConversationTurn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      deckWords: z.array(z.object({ arabic: z.string(), meaning: z.string() })).min(1).max(20),
      remainingWords: z.array(z.string()).min(0),
      history: z
        .array(
          z.object({
            role: z.enum(["ai", "user"]),
            arabic: z.string(),
          }),
        )
        .max(40),
      turnNumber: z.number().int().min(0),
      maxTurns: z.number().int().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const deckList = data.deckWords.map((w) => `${w.arabic} (${w.meaning})`).join(", ");
    const remaining = data.remainingWords.join(", ");
    const transcript = data.history
      .map((h) => `${h.role === "ai" ? "AI" : "USER"}: ${h.arabic}`)
      .join("\n");
    const isClosing = data.turnNumber + 1 >= data.maxTurns || data.remainingWords.length === 0;

    return (await callGemini({
      system:
        "You hold a fully Arabic conversation with a learner about a Quranic theme (a verse, divine attribute, prayer, guidance, mercy, the day of judgment, etc.). Use classical register with full tashkeel. Keep each turn short (1-2 sentences). After your line, the learner must reply in Arabic using one specific deck word.",
      user: `Deck words available: ${deckList}.
Words still un-used in user replies (prefer these): ${remaining || "(all used at least once — feel free to repeat any)"}.
Conversation so far:
${transcript || "(none yet)"}
Turn number: ${data.turnNumber + 1} of ${data.maxTurns}.

Produce the AI's next short Arabic line on a Quranic-context topic. Choose ONE deck word the learner should use in their next reply (prefer one from the un-used list; pick a word that fits the conversational opening you create). Provide an English gloss of your line and a brief English prompt hint about the expected reply.
${isClosing ? "This is the FINAL turn — wrap the conversation gracefully and set is_final=true." : "Set is_final=false."}`,
      tool: {
        name: "return_turn",
        description: "Return next conversation turn",
        parameters: convoTurnSchema,
      },
    })) as {
      arabic: string;
      translation: string;
      expected_word: string;
      prompt_hint: string;
      is_final: boolean;
    };
  });

const convoGradeSchema = {
  type: "object",
  properties: {
    grade: { type: "string", enum: ["strong", "adequate", "weak"] },
    feedback: { type: "string" },
    word_used_correctly: { type: "boolean" },
  },
  required: ["grade", "feedback", "word_used_correctly"],
  additionalProperties: false,
};

export const gradeConversationReply = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      aiLine: z.string(),
      expectedWord: z.string(),
      expectedMeaning: z.string(),
      userReply: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    return (await callGemini({
      system:
        "You are a strict Arabic-conversation grader. The learner's reply is judged PRIMARILY on whether the expected deck word is used correctly (right meaning, right grammatical role, right context). Whether the rest of the sentence is fully correct matters LESS. Be strict — generic or off-topic uses are 'weak'.",
      user: `AI's previous line: ${data.aiLine}
Expected deck word: ${data.expectedWord} (${data.expectedMeaning})
User's reply: ${data.userReply}

Grade strictly:
- "strong": the expected word is present and used with correct meaning + role + contextual fit.
- "adequate": the word is present and roughly fits, but with minor issues (slightly off context, minor grammatical mismatch).
- "weak": the word is missing, used with the wrong meaning, or used in a way that does not fit the AI's line at all.

Also return word_used_correctly (boolean) and 1-2 sentences of feedback in English.`,
      tool: { name: "return_grade", description: "Strict per-turn grade", parameters: convoGradeSchema },
    })) as { grade: "strong" | "adequate" | "weak"; feedback: string; word_used_correctly: boolean };
  });

/* ============================================================
 * Custom-deck word validation (unchanged)
 * ============================================================ */
const validateSchema = {
  type: "object",
  properties: {
    valid: { type: "boolean" },
    arabic: { type: "string", description: "The Arabic word, normalized" },
    meaning: { type: "string", description: "Best primary English meaning" },
    partOfSpeech: { type: "string" },
    usageNote: { type: "string" },
  },
  required: ["valid", "arabic", "meaning", "partOfSpeech", "usageNote"],
  additionalProperties: false,
};

export const validateAndEnrichWord = createServerFn({ method: "POST" })
  .inputValidator(z.object({ word: z.string() }))
  .handler(async ({ data }) => {
    return (await callGemini({
      system: "You validate Arabic words and return concise lexical metadata for a Quranic vocabulary app.",
      user: `Word: "${data.word}". If this is a valid Arabic word (preferably Quranic register), return valid=true with concise metadata. Add full tashkeel to the arabic field. If the input is not Arabic at all, return valid=false.`,
      tool: { name: "return_validation", description: "Return validation", parameters: validateSchema },
    })) as { valid: boolean; arabic: string; meaning: string; partOfSpeech: string; usageNote: string };
  });
