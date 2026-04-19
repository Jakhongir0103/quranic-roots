import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GOOGLE_TTS_API_BASE = "https://texttospeech.googleapis.com/v1";
const DEFAULT_LANGUAGE_CODE = process.env.GOOGLE_TTS_LANGUAGE_CODE || "ar-XA";
const DEFAULT_VOICE = process.env.GOOGLE_TTS_VOICE || "ar-XA-Wavenet-B";

export const synthesizeArabicSpeech = createServerFn({ method: "POST" })
  .inputValidator(z.object({ text: z.string().trim().min(1).max(2000) }))
  .handler(async ({ data }) => {
    const apiKey = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_CLOUD_TTS_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_TTS_API_KEY is not configured");

    const res = await fetch(`${GOOGLE_TTS_API_BASE}/text:synthesize?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: { text: data.text },
        voice: {
          languageCode: DEFAULT_LANGUAGE_CODE,
          name: DEFAULT_VOICE,
        },
        audioConfig: {
          audioEncoding: "MP3",
          speakingRate: 0.85,
          pitch: 0,
        },
      }),
    });

    if (!res.ok) {
      const details = await res.text();
      console.error("Google Cloud TTS error", res.status, details);
      throw new Error("TTS_ERROR");
    }

    const result = (await res.json()) as { audioContent?: string };
    if (!result.audioContent) throw new Error("TTS_EMPTY_AUDIO");

    return {
      audioContent: result.audioContent,
      mimeType: "audio/mpeg",
    };
  });
