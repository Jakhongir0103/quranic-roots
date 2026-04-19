import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-3-flash-preview"];

function getModelCandidates() {
  return [...new Set([DEFAULT_MODEL, ...FALLBACK_MODELS].filter(Boolean))];
}

async function callGeminiOnce(
  opts: {
    system: string;
    user: string;
    tool?: { name: string; description: string; parameters: unknown };
  },
  model: string,
  signal: AbortSignal,
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const body: Record<string, unknown> = {
    systemInstruction: {
      parts: [{ text: opts.system }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: opts.user }],
      },
    ],
  };

  if (opts.tool) {
    body.tools = [
      {
        functionDeclarations: [
          {
            name: opts.tool.name,
            description: opts.tool.description,
            parameters: opts.tool.parameters,
          },
        ],
      },
    ];
    body.toolConfig = {
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: [opts.tool.name],
      },
    };
  }

  const res = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (res.status === 429) throw new Error(`RATE_LIMIT:${model}`);
  if (res.status === 401 || res.status === 403) throw new Error("AUTH");
  if (!res.ok) {
    const t = await res.text();
    console.error("Gemini API error", res.status, t);
    throw new Error("AI_ERROR");
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];

  if (opts.tool) {
    const functionCall = parts.find((part: { functionCall?: unknown }) => part.functionCall)
      ?.functionCall as { name?: string; args?: unknown } | undefined;
    if (!functionCall?.args || functionCall.name !== opts.tool.name) {
      throw new Error("NO_TOOL_RESPONSE");
    }
    return functionCall.args;
  }

  return parts
    .map((part: { text?: string }) => part.text)
    .filter(Boolean)
    .join("");
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
  const modelCandidates = getModelCandidates();
  let lastErr: unknown;
  let sawRateLimit = false;

  for (const model of modelCandidates) {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
      try {
        return await callGeminiOnce(opts, model, ac.signal);
      } catch (e) {
        lastErr = e;
        const msg = (e as Error)?.message ?? "";

        // Auth errors are user-actionable; don't keep trying.
        if (msg === "AUTH") throw e;

        // If this model is rate-limited, try the next configured model.
        if (msg.startsWith("RATE_LIMIT:")) {
          sawRateLimit = true;
          console.warn(`Gemini model rate-limited: ${model}`);
          break;
        }

        console.warn(
          `Gemini call failed on ${model} (attempt ${attempt + 1}/${ATTEMPTS})`,
          msg,
        );
      } finally {
        clearTimeout(t);
      }
    }
  }

  if (sawRateLimit) throw new Error("RATE_LIMIT");
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
      },
    },
  },
  required: ["verses"],
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
        
      },
    },
    distractor: {
      type: "string",
      description: "One extra plausible Arabic word that does NOT belong to any sentence (same register, with tashkeel)",
    },
  },
  required: ["items", "distractor"],
  
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
      },
    },
    issue: {
      type: "string",
      description: "Plain-English explanation of WHY the incorrect sentence misuses the word (semantic, grammatical, or contextual mistake).",
    },
  },
  required: ["target_word", "target_meaning", "sentences", "issue"],
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
    arabic: { type: "string", description: "AI's next Arabic line (with full tashkeel)" },
    is_final: { type: "boolean", description: "True if this is the closing line of the conversation" },
  },
  required: ["arabic", "is_final"],
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
    const deckList = data.deckWords.map((w) => `${w.arabic} (${w.meaning})`).join("، ");
    const remaining = data.remainingWords.join("، ");
    const transcript = data.history
      .map((h) => `${h.role === "ai" ? "AI" : "USER"}: ${h.arabic}`)
      .join("\n");
    const isClosing = data.turnNumber + 1 >= data.maxTurns || data.remainingWords.length === 0;

    return (await callGemini({
      system:
        "أنت محاور باللغة العربية الفصحى مع متعلم في سياق قرآني (آية، صفة من صفات الله، الهداية، الرحمة، يوم الدين، إلخ). استخدم تشكيلًا كاملاً. اجعل دورك قصيرًا (جملة أو جملتين). يجب أن تصاغ كل جملة بحيث يضطر المتعلم في رده إلى استعمال إحدى كلمات الرصيد المعطى — لكن لا تذكر الكلمة المتوقعة ولا تلمّح إليها صراحةً ولا تطلب منه استخدام كلمة بعينها. اجعل السياق وحده يقود اختيار الكلمة.",
      user: `كلمات الرصيد المتاحة (لا تذكرها للمتعلم بشكل قائمة): ${deckList}.
الكلمات التي لم يستعملها المتعلم بعد (فضّل أن يقوده السياق إليها): ${remaining || "(جميعها استُعملت — يمكن تكرار أيٍّ منها)"}.

المحادثة حتى الآن:
${transcript || "(لم تبدأ بعد)"}

هذا هو دورك رقم ${data.turnNumber + 1} من ${data.maxTurns}.

اكتب الجملة العربية التالية فقط، بحيث:
1) تبقى ضمن سياق قرآني/إيماني واضح ومتصل بما سبق.
2) تكون مفتوحة بطريقةٍ تجعل ردًّا طبيعيًا يستلزم استخدام واحدة من كلمات الرصيد، دون أن تذكر تلك الكلمة أو تشير إليها.
3) لا تستخدم صيغة سؤالية مباشرة من نوع "استعمل كلمة كذا".
${isClosing ? "هذا هو الدور الأخير — اختم المحادثة بلطف واجعل is_final=true." : "اجعل is_final=false."}`,
      tool: {
        name: "return_turn",
        description: "Return next conversation turn (Arabic only)",
        parameters: convoTurnSchema,
      },
    })) as {
      arabic: string;
      is_final: boolean;
    };
  });

const convoGradeSchema = {
  type: "object",
  properties: {
    grade: { type: "string", enum: ["strong", "adequate", "weak"] },
    feedback: { type: "string", description: "Short Arabic feedback (1-2 sentences)" },
    matched_word: {
      type: "string",
      description:
        "The deck word the learner actually used (Arabic, exact form from the deck). Empty string if none was used.",
    },
    word_used_correctly: { type: "boolean" },
  },
  required: ["grade", "feedback", "matched_word", "word_used_correctly"],
};

export const gradeConversationReply = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      aiLine: z.string(),
      deckWords: z.array(z.object({ arabic: z.string(), meaning: z.string() })).min(1).max(20),
      userReply: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const list = data.deckWords.map((w) => `${w.arabic} = ${w.meaning}`).join("\n");
    return (await callGemini({
      system:
        "You are a strict Arabic-conversation grader. The learner is expected to reply using ONE of the deck words below — they were NOT told which one. Judge PRIMARILY on whether one of the deck words is used correctly (right meaning, right grammatical role, fits the AI's previous line in context). Whether the rest of the sentence is fully correct matters LESS. Be strict — if no deck word is used, or it is used in the wrong sense, that is 'weak'.",
      user: `AI's previous line: ${data.aiLine}
Deck words (any one of these would count if used correctly):
${list}

User's reply: ${data.userReply}

Identify which deck word the user actually used (matched_word — exact Arabic form from the list, or empty string if none). Then grade strictly:
- "strong": one of the deck words is present and used with correct meaning + role + contextual fit.
- "adequate": a deck word is present and roughly fits, but with minor issues (slightly off context, minor grammatical mismatch).
- "weak": no deck word is used, or it is used with the wrong meaning, or it does not fit the AI's line.

Feedback: 1-2 short sentences in Arabic.`,
      tool: { name: "return_grade", description: "Strict per-turn grade", parameters: convoGradeSchema },
    })) as {
      grade: "strong" | "adequate" | "weak";
      feedback: string;
      matched_word: string;
      word_used_correctly: boolean;
    };
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

/* ============================================================
 * Generate a deck from a natural-language prompt
 * e.g. "the 20 most occurring words in surah al baqarah"
 * ============================================================ */
const promptDeckSchema = {
  type: "object",
  properties: {
    deckName: { type: "string", description: "Short, descriptive deck name in English" },
    domain: { type: "string", description: "Short domain label (e.g. 'Surah Al-Baqarah')" },
    words: {
      type: "array",
      minItems: 3,
      maxItems: 30,
      items: {
        type: "object",
        properties: {
          arabic: { type: "string", description: "The Arabic word with FULL tashkeel" },
          meaning: { type: "string", description: "Concise primary English meaning" },
          partOfSpeech: { type: "string" },
          usageNote: { type: "string", description: "1 short note about how the word appears in the Quran" },
        },
        required: ["arabic", "meaning", "partOfSpeech", "usageNote"],
      },
    },
  },
  required: ["deckName", "domain", "words"],
};

export const generateDeckFromPrompt = createServerFn({ method: "POST" })
  .inputValidator(z.object({ prompt: z.string().min(3).max(500) }))
  .handler(async ({ data }) => {
    return (await callGemini({
      system:
        "You build curated Quranic-Arabic vocabulary decks from a learner's natural-language request. Words must be real Arabic words from the Qur'an (or strongly Quranic-register). Always include full tashkeel. Pick a reasonable count if the user did not specify (default 12-15). Skip very common particles unless the user explicitly asked for them.",
      user: `Build a vocabulary deck for this request: "${data.prompt}"

Return a deck name, a short domain label, and a list of words with Arabic (full tashkeel), concise English meaning, part of speech, and a short usage note about how the word appears in the Qur'an.`,
      tool: {
        name: "return_deck",
        description: "Return a generated deck",
        parameters: promptDeckSchema,
      },
    })) as {
      deckName: string;
      domain: string;
      words: { arabic: string; meaning: string; partOfSpeech: string; usageNote: string }[];
    };
  });
