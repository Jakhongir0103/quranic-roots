import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_STT_MODEL = process.env.OPENAI_STT_MODEL || "whisper-1";
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

export const transcribeArabicSpeech = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      audioBase64: z.string().min(1),
      mimeType: z.string().min(1).max(100).default("audio/webm"),
    }),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

    const audioBuffer = Buffer.from(data.audioBase64, "base64");
    if (audioBuffer.byteLength > MAX_AUDIO_BYTES) {
      throw new Error("AUDIO_TOO_LARGE");
    }

    const form = new FormData();
    const file = new File([audioBuffer], "stage-5-reply.webm", {
      type: data.mimeType,
    });

    form.append("file", file);
    form.append("model", DEFAULT_STT_MODEL);
    form.append("language", "ar");
    form.append("response_format", "json");
    form.append(
      "prompt",
      "Transcribe the learner's Arabic speech in Arabic script. The context is Quranic Arabic vocabulary practice.",
    );

    const res = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
    });

    if (!res.ok) {
      const details = await res.text();
      console.error("OpenAI transcription error", res.status, details);
      throw new Error("TRANSCRIPTION_ERROR");
    }

    const result = (await res.json()) as { text?: string };
    return { text: result.text?.trim() ?? "" };
  });
