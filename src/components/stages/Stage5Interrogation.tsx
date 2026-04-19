import { useEffect, useMemo, useRef, useState } from "react";
import type { Word } from "@/lib/db";
import { useServerFn } from "@tanstack/react-start";
import { generateConversationTurn, gradeConversationReply } from "@/lib/ai.functions";
import type { Grade } from "@/lib/srs";
import { StageBadge } from "../StageBadge";
import { Loader2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Turn {
  role: "ai" | "user";
  arabic: string;
  translation?: string;
  expected_word?: string;
  prompt_hint?: string;
  feedback?: string;
  grade?: "strong" | "adequate" | "weak";
  is_final?: boolean;
}

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ar-SA";
  utter.rate = 0.85;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

const colorMap: Record<string, string> = {
  strong: "border-success/40 bg-success/10 text-success",
  adequate: "border-stage-3/40 bg-stage-3/10",
  weak: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function Stage5Interrogation({
  words,
  onComplete,
}: {
  words: Word[];
  onComplete: (grade: Grade) => void;
}) {
  const nextTurn = useServerFn(generateConversationTurn);
  const grade = useServerFn(gradeConversationReply);
  const maxTurns = Math.max(words.length, 5);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [loadingAi, setLoadingAi] = useState(true);
  const [reply, setReply] = useState("");
  const [grading, setGrading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedWords, setUsedWords] = useState<Set<string>>(new Set());
  const [scores, setScores] = useState<("strong" | "adequate" | "weak")[]>([]);
  const requested = useRef(false);

  const wordPayload = useMemo(
    () => words.map((w) => ({ arabic: w.arabic, meaning: w.meaning })),
    [words],
  );
  const meaningOf = useMemo(() => {
    const m = new Map<string, string>();
    words.forEach((w) => m.set(w.arabic, w.meaning));
    return m;
  }, [words]);

  // Drive next AI turn whenever the conversation is waiting on one
  useEffect(() => {
    if (done || error) return;
    const last = turns[turns.length - 1];
    const aiOwesNext =
      turns.length === 0 || (last && last.role === "user" && !last.is_final);
    if (!aiOwesNext) return;
    if (requested.current) return;
    requested.current = true;
    (async () => {
      setLoadingAi(true);
      try {
        const remaining = wordPayload
          .map((w) => w.arabic)
          .filter((a) => !usedWords.has(a));
        const aiTurnsCount = turns.filter((t) => t.role === "ai").length;
        const r = await nextTurn({
          data: {
            deckWords: wordPayload,
            remainingWords: remaining,
            history: turns.map((t) => ({ role: t.role, arabic: t.arabic })),
            turnNumber: aiTurnsCount,
            maxTurns,
          },
        });
        setTurns((prev) => [
          ...prev,
          {
            role: "ai",
            arabic: r.arabic,
            translation: r.translation,
            expected_word: r.expected_word,
            prompt_hint: r.prompt_hint,
            is_final: r.is_final,
          },
        ]);
        speak(r.arabic);
        if (r.is_final) {
          setDone(true);
        }
      } catch (e) {
        console.error(e);
        setError("Could not continue the conversation.");
      } finally {
        setLoadingAi(false);
        requested.current = false;
      }
    })();
  }, [turns, done, error, nextTurn, wordPayload, usedWords, maxTurns]);

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

  // When done becomes true and last turn is AI's final closing line, allow user to finish
  const lastTurn = turns[turns.length - 1];
  const awaitingUser = lastTurn?.role === "ai" && !done;
  const canFinish = done && lastTurn?.role === "ai";

  const submitReply = async () => {
    if (!reply.trim() || !lastTurn || lastTurn.role !== "ai" || !lastTurn.expected_word) return;
    setGrading(true);
    const userText = reply.trim();
    try {
      const r = await grade({
        data: {
          aiLine: lastTurn.arabic,
          expectedWord: lastTurn.expected_word,
          expectedMeaning: meaningOf.get(lastTurn.expected_word) ?? "",
          userReply: userText,
        },
      });
      setTurns((prev) => [
        ...prev,
        { role: "user", arabic: userText, feedback: r.feedback, grade: r.grade },
      ]);
      const nextScores = [...scores, r.grade];
      setScores(nextScores);
      if (r.word_used_correctly) {
        setUsedWords((prev) => new Set(prev).add(lastTurn.expected_word!));
      }
      setReply("");
      // If AI's last turn was already final, finalize after user replies.
      if (lastTurn.is_final) {
        setDone(true);
        finalize(nextScores);
      }
    } catch (e) {
      console.error(e);
      setTurns((prev) => [
        ...prev,
        { role: "user", arabic: userText, feedback: "Couldn't grade.", grade: "adequate" },
      ]);
    } finally {
      setGrading(false);
    }
  };

  if (error) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button onClick={() => onComplete("weak")}>Skip</Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <StageBadge stage={5} />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {usedWords.size} / {words.length} words used
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Continue the Arabic conversation. Reply using the highlighted deck word in each turn.
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
                {t.role === "ai" ? "AI" : "You"}
              </span>
              {t.role === "ai" && (
                <button
                  onClick={() => speak(t.arabic)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Play"
                >
                  <Volume2 className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="arabic-quran text-right text-lg leading-loose" dir="rtl">
              {t.arabic}
            </div>
            {t.translation && (
              <div className="mt-1 text-xs text-muted-foreground">{t.translation}</div>
            )}
            {t.role === "ai" && t.expected_word && i === turns.length - 1 && awaitingUser && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border bg-background/60 px-3 py-2">
                <div className="text-[11px] text-muted-foreground">
                  Reply using:{" "}
                  <span className="arabic-quran text-base text-foreground">{t.expected_word}</span>
                </div>
                {t.prompt_hint && (
                  <div className="text-[11px] italic text-muted-foreground">{t.prompt_hint}</div>
                )}
              </div>
            )}
            {t.role === "user" && t.grade && t.feedback && (
              <div className={`mt-2 rounded-lg border p-2 text-xs ${colorMap[t.grade]}`}>
                <span className="font-semibold uppercase tracking-wider">{t.grade}</span>
                <span className="ml-2">{t.feedback}</span>
              </div>
            )}
          </li>
        ))}
      </ul>

      {loadingAi && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          AI is typing…
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
            disabled={grading}
          />
          <Button onClick={submitReply} disabled={!reply.trim()} className="w-full" size="lg">
            Send reply
          </Button>
        </div>
      )}

      {grading && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Grading your reply…
        </div>
      )}

      {canFinish && (
        <Button onClick={() => finalize(scores)} className="w-full" size="lg">
          Finish conversation
        </Button>
      )}
    </div>
  );
}
