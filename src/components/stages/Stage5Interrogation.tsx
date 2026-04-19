import { useEffect, useMemo, useRef, useState } from "react";
import type { Word } from "@/lib/db";
import { useServerFn } from "@tanstack/react-start";
import { generateConversationTurn, gradeConversationReply } from "@/lib/ai.functions";
import type { Grade } from "@/lib/srs";
import { StageBadge } from "../StageBadge";
import { Loader2, Mic, Square, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useArabicTts } from "@/hooks/useArabicTts";
import { useSpeechToText } from "@/hooks/useSpeechToText";

interface Turn {
  role: "ai" | "user";
  arabic: string;
  feedback?: string;
  grade?: "strong" | "adequate" | "weak";
  matched_word?: string;
  is_final?: boolean;
}

const colorMap: Record<string, string> = {
  strong: "border-success/40 bg-success/10 text-success",
  adequate: "border-stage-3/40 bg-stage-3/10",
  weak: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function Stage5Interrogation({
  words,
  difficulty = 3,
  onComplete,
}: {
  words: Word[];
  difficulty?: number;
  onComplete: (grade: Grade) => void;
}) {
  const nextTurn = useServerFn(generateConversationTurn);
  const grade = useServerFn(gradeConversationReply);
  const maxTurns = Math.max(words.length, difficulty <= 2 ? 4 : difficulty >= 4 ? 7 : 5);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [loadingAi, setLoadingAi] = useState(true);
  const [reply, setReply] = useState("");
  const [grading, setGrading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedWords, setUsedWords] = useState<Set<string>>(new Set());
  const [scores, setScores] = useState<("strong" | "adequate" | "weak")[]>([]);
  const requested = useRef(false);
  const { speakArabic } = useArabicTts();
  const {
    isRecording,
    isTranscribing,
    speechError,
    startRecording,
    stopAndTranscribe,
    cancelRecording,
  } = useSpeechToText();

  const wordPayload = useMemo(
    () => words.map((w) => ({ arabic: w.arabic, meaning: w.meaning })),
    [words],
  );

  // Drive next AI turn whenever the conversation is waiting on one
  useEffect(() => {
    if (done || error) return;
    const last = turns[turns.length - 1];
    const aiOwesNext = turns.length === 0 || (last && last.role === "user" && !last.is_final);
    if (!aiOwesNext) return;
    if (requested.current) return;
    requested.current = true;
    (async () => {
      setLoadingAi(true);
      try {
        const remaining = wordPayload.map((w) => w.arabic).filter((a) => !usedWords.has(a));
        const aiTurnsCount = turns.filter((t) => t.role === "ai").length;
        const r = await nextTurn({
          data: {
            deckWords: wordPayload,
            remainingWords: remaining,
            history: turns.map((t) => ({ role: t.role, arabic: t.arabic })),
            turnNumber: aiTurnsCount,
            maxTurns,
            difficulty,
          },
        });
        setTurns((prev) => [
          ...prev,
          {
            role: "ai",
            arabic: r.arabic,
            is_final: r.is_final,
          },
        ]);
        void speakArabic(r.arabic);
        if (r.is_final) {
          setDone(true);
        }
      } catch (e) {
        console.error(e);
        setError("تعذّر متابعة المحادثة.");
      } finally {
        setLoadingAi(false);
        requested.current = false;
      }
    })();
  }, [turns, done, error, nextTurn, wordPayload, usedWords, maxTurns, difficulty, speakArabic]);

  const finalize = (allScores: ("strong" | "adequate" | "weak")[]) => {
    if (allScores.length === 0) return onComplete("weak");
    const strong = allScores.filter((s) => s === "strong").length;
    const ok = allScores.filter((s) => s === "strong" || s === "adequate").length;
    const ratio = ok / allScores.length;
    const strongRatio = strong / allScores.length;
    let g: Grade = "weak";
    if (strongRatio >= 0.6) g = "strong";
    else if (ratio >= 0.6) g = "adequate";
    onComplete(g);
  };

  const lastTurn = turns[turns.length - 1];
  const awaitingUser = lastTurn?.role === "ai" && !done;
  const canFinish = done && lastTurn?.role === "ai";

  const submitReply = async () => {
    if (!reply.trim() || !lastTurn || lastTurn.role !== "ai") return;
    setGrading(true);
    const userText = reply.trim();
    try {
      const r = await grade({
        data: {
          aiLine: lastTurn.arabic,
          deckWords: wordPayload,
          userReply: userText,
        },
      });
      setTurns((prev) => [
        ...prev,
        {
          role: "user",
          arabic: userText,
          feedback: r.feedback,
          grade: r.grade,
          matched_word: r.matched_word,
        },
      ]);
      const nextScores = [...scores, r.grade];
      setScores(nextScores);
      if (r.word_used_correctly && r.matched_word) {
        setUsedWords((prev) => new Set(prev).add(r.matched_word));
      }
      setReply("");
      if (lastTurn.is_final) {
        setDone(true);
        finalize(nextScores);
      }
    } catch (e) {
      console.error(e);
      setTurns((prev) => [
        ...prev,
        { role: "user", arabic: userText, feedback: "تعذّر التقييم.", grade: "adequate" },
      ]);
    } finally {
      setGrading(false);
    }
  };

  const toggleSpeechInput = async () => {
    if (isRecording) {
      const transcript = await stopAndTranscribe();
      if (transcript) {
        setReply((current) => (current.trim() ? `${current.trim()} ${transcript}` : transcript));
      }
      return;
    }

    await startRecording();
  };

  if (error) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button onClick={() => onComplete("weak")}>تخطّي</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <StageBadge stage={5} />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {usedWords.size} / {words.length} كلمات استُعملت
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        تابع المحادثة بالعربية. اختر بنفسك الكلمة المناسبة من الرصيد دون أن يخبرك النظام أيّها.
      </p>

      <ul className="space-y-3">
        {turns.map((t, i) => (
          <li
            key={i}
            className={`rounded-xl border p-3 ${
              t.role === "ai" ? "border-border bg-card" : "border-border bg-surface"
            }`}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t.role === "ai" ? "AI" : "أنت"}
              </span>
              {t.role === "ai" && (
                <button
                  onClick={() => void speakArabic(t.arabic)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="استمع"
                >
                  <Volume2 className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="arabic-quran text-right text-lg leading-loose" dir="rtl">
              {t.arabic}
            </div>
            {t.role === "user" && t.grade && t.feedback && (
              <div className={`mt-2 rounded-lg border p-2 text-xs ${colorMap[t.grade]}`} dir="rtl">
                <span className="arabic font-semibold">{t.feedback}</span>
                {t.matched_word ? (
                  <span className="arabic-quran ml-2 text-foreground/80">· {t.matched_word}</span>
                ) : null}
              </div>
            )}
          </li>
        ))}
      </ul>

      {loadingAi && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          الذكاء الاصطناعي يكتب…
        </div>
      )}

      {awaitingUser && !grading && (
        <div className="space-y-2">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="اكتب ردك بالعربية…"
            className="arabic min-h-[100px] text-right text-lg"
            dir="rtl"
            disabled={grading || isTranscribing}
          />
          {speechError && <p className="text-xs text-destructive">{speechError}</p>}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button
              type="button"
              variant={isRecording ? "destructive" : "secondary"}
              onClick={toggleSpeechInput}
              disabled={isTranscribing}
              className="rounded-xl"
            >
              {isTranscribing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : isRecording ? (
                <Square className="mr-2 h-4 w-4" />
              ) : (
                <Mic className="mr-2 h-4 w-4" />
              )}
              {isTranscribing
                ? "Transcribing..."
                : isRecording
                  ? "Stop and transcribe"
                  : "Speak reply"}
            </Button>
            {isRecording && (
              <Button
                type="button"
                variant="outline"
                onClick={cancelRecording}
                className="rounded-xl"
              >
                Cancel
              </Button>
            )}
          </div>
          <Button
            onClick={submitReply}
            disabled={!reply.trim() || isTranscribing}
            className="w-full"
            size="lg"
          >
            إرسال الرد
          </Button>
        </div>
      )}

      {grading && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          جارٍ تقييم الرد…
        </div>
      )}

      {canFinish && (
        <Button onClick={() => finalize(scores)} className="w-full" size="lg">
          إنهاء المحادثة
        </Button>
      )}
    </div>
  );
}
