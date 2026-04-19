import { useCallback, useRef, type MutableRefObject } from "react";
import { useServerFn } from "@tanstack/react-start";
import { synthesizeArabicSpeech } from "@/lib/tts.functions";

interface TtsAudio {
  audioContent: string;
  mimeType: string;
}

function audioUrl(audio: TtsAudio) {
  return `data:${audio.mimeType};base64,${audio.audioContent}`;
}

function playUrl(url: string, currentAudio: MutableRefObject<HTMLAudioElement | null>) {
  return new Promise<void>((resolve, reject) => {
    currentAudio.current?.pause();

    const audio = new Audio(url);
    audio.volume = 1;
    currentAudio.current = audio;

    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error("AUDIO_PLAYBACK_ERROR"));

    audio.play().catch(reject);
  });
}

export function useArabicTts() {
  const synthesize = useServerFn(synthesizeArabicSpeech);
  const cache = useRef(new Map<string, TtsAudio>());
  const currentAudio = useRef<HTMLAudioElement | null>(null);

  const getAudio = useCallback(
    async (text: string) => {
      const normalized = text.trim();
      const cached = cache.current.get(normalized);
      if (cached) return cached;

      const audio = await synthesize({ data: { text: normalized } });
      cache.current.set(normalized, audio);
      return audio;
    },
    [synthesize],
  );

  const speakArabic = useCallback(
    async (text: string) => {
      const normalized = text.trim();
      if (!normalized) return;

      try {
        const audio = await getAudio(normalized);
        await playUrl(audioUrl(audio), currentAudio);
      } catch (error) {
        console.error("Arabic TTS playback failed", error);
      }
    },
    [getAudio],
  );

  const speakArabicLines = useCallback(
    async (lines: string[]) => {
      const cleaned = lines.map((line) => line.trim()).filter(Boolean);
      if (cleaned.length === 0) return;

      try {
        const audios = await Promise.all(cleaned.map((line) => getAudio(line)));
        for (const audio of audios) {
          await playUrl(audioUrl(audio), currentAudio);
        }
      } catch (error) {
        console.error("Arabic TTS playback failed", error);
      }
    },
    [getAudio],
  );

  const stopArabic = useCallback(() => {
    currentAudio.current?.pause();
    currentAudio.current = null;
  }, []);

  return { speakArabic, speakArabicLines, stopArabic };
}
