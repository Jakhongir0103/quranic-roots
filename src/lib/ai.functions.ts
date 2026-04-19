import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-3-flash-preview";

async function callGemini(opts: {
  system: string;
  user: string;
  tool?: { name: string; description: string; parameters: unknown };
}) {
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

const sentencesSchema = {
  type: "object",
  properties: {
    sentences: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          arabic: { type: "string", description: "Arabic sentence with full diacritics, including the target word" },
          translation: { type: "string", description: "English translation with the target word replaced by ___" },
          meaning_tag: { type: "string", description: "Short English phrase that fills the ___" },
        },
        required: ["arabic", "translation", "meaning_tag"],
        additionalProperties: false,
      },
    },
  },
  required: ["sentences"],
  additionalProperties: false,
};

export const generateContextSentences = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      arabic: z.string().min(1),
      meaning: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const result = await callGemini({
      system:
        "You generate authentic classical/Quranic-register Arabic content for a vocabulary learning app called Mizan. Use full tashkeel. Respect classical grammar. Keep sentences short (5-10 words).",
      user: `Target word: ${data.arabic} — meaning: "${data.meaning}".\n\nGenerate exactly 3 short Arabic sentences using this exact word in three meaningfully different contexts. In each English translation, replace the target word with "___". For each sentence give one short English phrase tag (2-4 words) that would fill the blank.`,
      tool: {
        name: "return_sentences",
        description: "Return three Arabic context sentences",
        parameters: sentencesSchema,
      },
    });
    return result as {
      sentences: { arabic: string; translation: string; meaning_tag: string }[];
    };
  });

const dialogueSchema = {
  type: "object",
  properties: {
    exchanges: {
      type: "array",
      minItems: 6,
      maxItems: 10,
      items: {
        type: "object",
        properties: {
          speaker: { type: "string", enum: ["A", "B"] },
          arabic: { type: "string" },
          translation: { type: "string" },
          uses_target: { type: "boolean" },
        },
        required: ["speaker", "arabic", "translation", "uses_target"],
        additionalProperties: false,
      },
    },
    pause_after_index: { type: "number", description: "Index of Speaker A line after which to pause for user choice" },
    choice_options: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "string", description: "An English response option" },
    },
    correct_choice_index: { type: "number" },
    comprehension: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 },
          correct_index: { type: "number" },
        },
        required: ["question", "options", "correct_index"],
        additionalProperties: false,
      },
    },
  },
  required: ["exchanges", "pause_after_index", "choice_options", "correct_choice_index", "comprehension"],
  additionalProperties: false,
};

export const generateDialogue = createServerFn({ method: "POST" })
  .inputValidator(z.object({ arabic: z.string(), meaning: z.string() }))
  .handler(async ({ data }) => {
    const result = await callGemini({
      system:
        "You write short, natural classical Arabic dialogues for a Quranic vocabulary app. Use full tashkeel.",
      user: `Target word: ${data.arabic} (${data.meaning}). Generate a 6-8 line dialogue between Speaker A and Speaker B that uses this word at least twice. Choose one Speaker A line as the pause point and provide 2 English response options for what Speaker B would say. Also generate 2 comprehension multiple-choice questions about meaning of the target word in the dialogue.`,
      tool: {
        name: "return_dialogue",
        description: "Return a dialogue with comprehension data",
        parameters: dialogueSchema,
      },
    });
    return result;
  });

const clozeSchema = {
  type: "object",
  properties: {
    sentence: { type: "string", description: "Arabic sentence with one ___ blank, full tashkeel elsewhere" },
    correct_answer: { type: "string", description: "The exact Arabic word/form that fills the blank" },
    explanation: { type: "string", description: "1-2 sentence English explanation of the form" },
  },
  required: ["sentence", "correct_answer", "explanation"],
  additionalProperties: false,
};

export const generateCloze = createServerFn({ method: "POST" })
  .inputValidator(z.object({ arabic: z.string(), meaning: z.string() }))
  .handler(async ({ data }) => {
    return (await callGemini({
      system: "You generate Arabic cloze sentences for a Quranic vocabulary app. The blank must unambiguously require the target word.",
      user: `Generate one short Arabic sentence (5-8 words) where the target word ${data.arabic} (${data.meaning}) is removed and replaced with ___. Provide the exact correct answer and a brief explanation.`,
      tool: { name: "return_cloze", description: "Return a cloze item", parameters: clozeSchema },
    })) as { sentence: string; correct_answer: string; explanation: string };
  });

const challengeSchema = {
  type: "object",
  properties: {
    challenge_type: { type: "string", enum: ["translation", "context_meaning", "contrast", "open_explanation"] },
    question: { type: "string" },
    ideal_elements: { type: "array", items: { type: "string" } },
    rubric: { type: "string" },
  },
  required: ["challenge_type", "question", "ideal_elements", "rubric"],
  additionalProperties: false,
};

export const generateChallenge = createServerFn({ method: "POST" })
  .inputValidator(z.object({ arabic: z.string(), meaning: z.string() }))
  .handler(async ({ data }) => {
    return (await callGemini({
      system: "You generate comprehension challenges for vocabulary mastery.",
      user: `Generate one comprehension challenge for the Arabic word ${data.arabic} meaning "${data.meaning}". Pick the most useful challenge type. The question must be answerable in 1-3 English sentences.`,
      tool: { name: "return_challenge", description: "Return one challenge", parameters: challengeSchema },
    })) as {
      challenge_type: string;
      question: string;
      ideal_elements: string[];
      rubric: string;
    };
  });

const gradeSchema = {
  type: "object",
  properties: {
    grade: { type: "string", enum: ["strong", "adequate", "weak"] },
    feedback: { type: "string" },
  },
  required: ["grade", "feedback"],
  additionalProperties: false,
};

export const gradeResponse = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      question: z.string(),
      idealElements: z.array(z.string()),
      rubric: z.string(),
      response: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    return (await callGemini({
      system: "You grade student responses concisely. Be honest but encouraging.",
      user: `Question: ${data.question}\nIdeal elements: ${data.idealElements.join("; ")}\nRubric: ${data.rubric}\n\nStudent response: "${data.response}"\n\nGrade as strong / adequate / weak. Provide 2-3 sentences of specific feedback.`,
      tool: { name: "return_grade", description: "Grade the response", parameters: gradeSchema },
    })) as { grade: "strong" | "adequate" | "weak"; feedback: string };
  });

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
