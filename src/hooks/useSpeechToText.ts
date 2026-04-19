import { useCallback, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { transcribeArabicSpeech } from "@/lib/stt.functions";

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("AUDIO_READ_ERROR"));
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== "string") {
        reject(new Error("AUDIO_READ_ERROR"));
        return;
      }
      resolve(value.split(",")[1] ?? "");
    };
    reader.readAsDataURL(blob);
  });
}

export function useSpeechToText() {
  const transcribe = useServerFn(transcribeArabicSpeech);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Speech recording is not supported in this browser.");
      return;
    }

    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      console.error(e);
      setError("Microphone permission was denied or unavailable.");
      return;
    }

    const options: MediaRecorderOptions = {};
    if (MediaRecorder.isTypeSupported("audio/webm")) {
      options.mimeType = "audio/webm";
    }
    const recorder = new MediaRecorder(stream, options);

    chunks.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
    };

    mediaRecorder.current = recorder;
    recorder.start();
    setIsRecording(true);
  }, []);

  const stopAndTranscribe = useCallback(async () => {
    const recorder = mediaRecorder.current;
    if (!recorder || recorder.state === "inactive") return "";

    setError(null);
    setIsRecording(false);
    setIsTranscribing(true);

    const audio = await new Promise<Blob>((resolve) => {
      recorder.addEventListener(
        "stop",
        () => {
          resolve(new Blob(chunks.current, { type: recorder.mimeType || "audio/webm" }));
        },
        { once: true },
      );
      recorder.stop();
    });

    try {
      const audioBase64 = await blobToBase64(audio);
      const result = await transcribe({
        data: {
          audioBase64,
          mimeType: audio.type || "audio/webm",
        },
      });
      return result.text;
    } catch (e) {
      console.error(e);
      setError("Could not transcribe your speech.");
      return "";
    } finally {
      setIsTranscribing(false);
      mediaRecorder.current = null;
      chunks.current = [];
    }
  }, [transcribe]);

  const cancelRecording = useCallback(() => {
    const recorder = mediaRecorder.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stream.getTracks().forEach((track) => track.stop());
      recorder.stop();
    }
    mediaRecorder.current = null;
    chunks.current = [];
    setIsRecording(false);
    setIsTranscribing(false);
  }, []);

  return {
    isRecording,
    isTranscribing,
    speechError: error,
    startRecording,
    stopAndTranscribe,
    cancelRecording,
  };
}
