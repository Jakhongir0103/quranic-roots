import { useEffect, useMemo, useRef, useState } from "react";
import type { Word } from "@/lib/db";
import { useServerFn } from "@tanstack/react-start";
import { generateDeckDialogue } from "@/lib/ai.functions";
import type { Grade } from "@/lib/srs";
import { StageBadge } from "../StageBadge";
import { Loader2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useArabicTts } from "@/hooks/useArabicTts";
import { dialogueKey, readDialogueCache, type DialogueData } from "@/lib/ai-preload";

/** Bold any deck-word occurrences inside an Arabic line. */
function EmphasizedArabic({ text, targets }: { text: string; targets: string[] }) {
  if (targets.length === 0) return <>{text}</>;
  // Build a regex that matches any of the target words. Escape special chars.
  const escaped = targets.filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) return <>{text}</>;
  const re = new RegExp(`(${escaped.join("|")})`, "g");
  const parts = text.split(re);
  return (
    <>
      {parts.map((p, i) =>
        targets.includes(p) ? (
          <strong key={i} className="font-bold text-foreground">
            {p}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function Stage3Listening({
  words,
  deckName,
  difficulty = 3,
  onComplete,
}: {
  words: Word[];
  deckName?: string;
  difficulty?: number;
  onComplete: (grade: Grade) => void;
}) {
  const generate = useServerFn(generateDeckDialogue);
  const [data, setData] = useState<DialogueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [phase, setPhase] = useState<"dialogue" | "choice" | "post" | "questions">("dialogue");
  const [choicePicked, setChoicePicked] = useState<number | null>(null);
  const [qIndex, setQIndex] = useState(0);
  const [qScore, setQScore] = useState(0);
  const [qPicked, setQPicked] = useState<number | null>(null);
  const { speakArabic, speakArabicLines } = useArabicTts();
  const spokeInitialLine = useRef(false);

  const targetForms = useMemo(() => words.map((w) => w.arabic), [words]);
  const wordPayload = useMemo(
    () => words.map((w) => ({ arabic: w.arabic, meaning: w.meaning })),
    [words],
  );
  const preloadKey = useMemo(
    () => dialogueKey(wordPayload, deckName, difficulty),
    [wordPayload, deckName, difficulty],
  );

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    spokeInitialLine.current = false;
    (async () => {
      try {
        const r = await readDialogueCache(
          preloadKey,
          () =>
            generate({
              data: { words: wordPayload, deckName, difficulty },
            }) as Promise<DialogueData>,
        );
        if (!alive) return;
        setData(r);
      } catch (e) {
        console.error(e);
        if (alive) setError("Could not generate dialogue.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [generate, preloadKey, wordPayload, deckName, difficulty]);

  useEffect(() => {
    if (!data || spokeInitialLine.current) return;
    spokeInitialLine.current = true;
    void speakArabic(data.exchanges[0]?.arabic ?? "");
  }, [data, speakArabic]);

  if (error) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button onClick={() => onComplete("struggled")}>Skip</Button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-sm">Composing dialogue…</p>
      </div>
    );
  }

  const revealNext = () => {
    const next = revealed + 1;
    if (revealed === data.pause_after_index) {
      setPhase("choice");
      return;
    }
    if (next >= data.exchanges.length) {
      setPhase("questions");
      return;
    }
    setRevealed(next);
    void speakArabic(data.exchanges[next].arabic);
  };

  const pickChoice = (i: number) => {
    setChoicePicked(i);
    setPhase("post");
  };

  const continueAfterChoice = () => {
    const next = revealed + 1;
    if (next >= data.exchanges.length) {
      setPhase("questions");
    } else {
      setRevealed(next);
      setPhase("dialogue");
      void speakArabic(data.exchanges[next].arabic);
    }
  };

  const pickQ = (i: number) => {
    if (qPicked !== null) return;
    setQPicked(i);
    const isCorrect = i === data.questions[qIndex].correct_index;
    if (isCorrect) setQScore((s) => s + 1);
    setTimeout(() => {
      if (qIndex + 1 < data.questions.length) {
        setQIndex(qIndex + 1);
        setQPicked(null);
      } else {
        const finalScore = qScore + (isCorrect ? 1 : 0);
        const ratio = finalScore / data.questions.length;
        const grade: Grade = ratio >= 0.8 ? "correct" : ratio >= 0.5 ? "partial" : "struggled";
        onComplete(grade);
      }
    }, 950);
  };

  // Dialogue list (always visible while in dialogue/choice/post; also stays during questions)
  const dialogueList = (
    <ul className="space-y-2">
      {data.exchanges.slice(0, Math.min(revealed + 1, data.exchanges.length)).map((ex, i) => (
        <li
          key={i}
          className={`rounded-xl border border-border p-3 ${
            ex.speaker === "A" ? "bg-card" : "bg-surface"
          }`}
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Speaker {ex.speaker}
            </span>
            <button
              onClick={() => void speakArabic(ex.arabic)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Play line"
            >
              <Volume2 className="h-3 w-3" />
            </button>
          </div>
          <div className="arabic-quran text-right text-lg leading-loose" dir="rtl">
            <EmphasizedArabic text={ex.arabic} targets={targetForms} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{ex.translation}</div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <StageBadge stage={3} />
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[11px] uppercase tracking-wider text-muted-foreground">
            {data.topic}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 shrink-0 rounded-lg px-2"
            onClick={() =>
              speakArabicLines(
                data.exchanges
                  .slice(0, Math.min(revealed + 1, data.exchanges.length))
                  .map((ex) => ex.arabic),
              )
            }
          >
            <Volume2 className="mr-1.5 h-3.5 w-3.5" />
            Play
          </Button>
        </div>
      </div>

      {dialogueList}

      {phase === "dialogue" && (
        <Button onClick={revealNext} className="w-full" size="lg">
          {revealed + 1 < data.exchanges.length ? "Next line" : "Finish dialogue"}
        </Button>
      )}

      {phase === "choice" && (
        <div className="space-y-3">
          <p className="text-sm font-medium">How would Speaker B respond?</p>
          {data.choice_options_arabic.map((opt, i) => (
            <button
              key={i}
              onClick={() => pickChoice(i)}
              className="block w-full rounded-xl border border-border bg-card p-3 text-right transition-colors hover:border-foreground/30"
              dir="rtl"
            >
              <div className="arabic-quran text-lg">
                <EmphasizedArabic text={opt} targets={targetForms} />
              </div>
            </button>
          ))}
        </div>
      )}

      {phase === "post" && (
        <div className="space-y-3">
          <div
            className={`rounded-xl p-3 text-sm ${
              choicePicked === data.correct_choice_index
                ? "bg-success/10 text-success"
                : "bg-warning/15 text-warning-foreground"
            }`}
          >
            {choicePicked === data.correct_choice_index ? (
              "Correct."
            ) : (
              <>
                <div>Better answer:</div>
                <div className="arabic-quran mt-1 text-right text-lg" dir="rtl">
                  <EmphasizedArabic
                    text={data.choice_options_arabic[data.correct_choice_index]}
                    targets={targetForms}
                  />
                </div>
              </>
            )}
          </div>
          <Button onClick={continueAfterChoice} className="w-full">
            Continue
          </Button>
        </div>
      )}

      {phase === "questions" && (
        <div className="space-y-3 rounded-2xl border border-border bg-card/60 p-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {data.questions[qIndex].kind === "meaning"
                ? "Meaning question"
                : "Role / function question"}{" "}
              · {qIndex + 1} / {data.questions.length}
            </p>
            <span className="arabic-quran text-base" dir="rtl">
              {data.questions[qIndex].target_word}
            </span>
          </div>
          <p className="font-medium">{data.questions[qIndex].question}</p>
          <div className="space-y-2">
            {data.questions[qIndex].options.map((opt, i) => {
              const isCorrect = i === data.questions[qIndex].correct_index;
              const picked = qPicked === i;
              return (
                <button
                  key={i}
                  onClick={() => pickQ(i)}
                  disabled={qPicked !== null}
                  className={`block w-full rounded-xl border p-3 text-left text-sm transition-colors ${
                    qPicked === null
                      ? "border-border bg-card hover:border-foreground/30"
                      : picked && isCorrect
                        ? "border-success bg-success/10 text-success"
                        : picked
                          ? "border-destructive bg-destructive/10 text-destructive"
                          : isCorrect
                            ? "border-success bg-success/10 text-success"
                            : "border-border bg-card opacity-60"
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
