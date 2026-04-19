import { useEffect, useState } from "react";
import type { Word } from "@/lib/db";
import { useServerFn } from "@tanstack/react-start";
import { generateDialogue } from "@/lib/ai.functions";
import type { Grade } from "@/lib/srs";
import { StageBadge } from "../StageBadge";
import { Loader2, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Exchange {
  speaker: "A" | "B";
  arabic: string;
  translation: string;
  uses_target: boolean;
}

interface DialogueData {
  exchanges: Exchange[];
  pause_after_index: number;
  choice_options: string[];
  correct_choice_index: number;
  comprehension: { question: string; options: string[]; correct_index: number }[];
}

function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ar-SA";
  utter.rate = 0.85;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

export function Stage3Listening({
  word,
  onComplete,
}: {
  word: Word;
  onComplete: (grade: Grade) => void;
}) {
  const generate = useServerFn(generateDialogue);
  const [data, setData] = useState<DialogueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [phase, setPhase] = useState<"dialogue" | "choice" | "post" | "comprehension">("dialogue");
  const [choicePicked, setChoicePicked] = useState<number | null>(null);
  const [compIndex, setCompIndex] = useState(0);
  const [compScore, setCompScore] = useState(0);
  const [compPicked, setCompPicked] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = (await generate({ data: { arabic: word.arabic, meaning: word.meaning } })) as DialogueData;
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
  }, [generate, word.arabic, word.meaning]);

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
    const justRevealed = data.exchanges[revealed];
    speak(justRevealed.arabic);
    if (revealed === data.pause_after_index) {
      setPhase("choice");
      return;
    }
    if (next >= data.exchanges.length) {
      setPhase("comprehension");
      return;
    }
    setRevealed(next);
  };

  const pickChoice = (i: number) => {
    setChoicePicked(i);
    setPhase("post");
  };

  const continueAfterChoice = () => {
    setRevealed((r) => r + 1);
    if (revealed + 1 >= data.exchanges.length) setPhase("comprehension");
    else setPhase("dialogue");
  };

  const pickComp = (i: number) => {
    if (compPicked !== null) return;
    setCompPicked(i);
    if (i === data.comprehension[compIndex].correct_index) setCompScore((s) => s + 1);
    setTimeout(() => {
      if (compIndex + 1 < data.comprehension.length) {
        setCompIndex(compIndex + 1);
        setCompPicked(null);
      } else {
        const finalScore =
          compScore + (i === data.comprehension[compIndex].correct_index ? 1 : 0);
        const grade: Grade = finalScore === 2 ? "correct" : finalScore === 1 ? "partial" : "struggled";
        onComplete(grade);
      }
    }, 900);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <StageBadge stage={3} />
        <div className="arabic-quran text-2xl">{word.arabic}</div>
      </div>

      {phase !== "comprehension" && (
        <ul className="space-y-3">
          {data.exchanges.slice(0, revealed + 1).map((ex, i) => (
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
                  onClick={() => speak(ex.arabic)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Volume2 className="h-3 w-3" />
                </button>
              </div>
              <div className={`arabic-quran text-right text-lg ${ex.uses_target ? "text-accent" : ""}`} dir="rtl">
                {ex.arabic}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{ex.translation}</div>
            </li>
          ))}
        </ul>
      )}

      {phase === "dialogue" && (
        <Button onClick={revealNext} className="w-full" size="lg">
          {revealed + 1 < data.exchanges.length ? "Next line" : "Finish"}
        </Button>
      )}

      {phase === "choice" && (
        <div className="space-y-3">
          <p className="text-sm font-medium">How would Speaker B respond?</p>
          {data.choice_options.map((opt, i) => (
            <button
              key={i}
              onClick={() => pickChoice(i)}
              className="block w-full rounded-xl border border-border bg-card p-3 text-left text-sm transition-colors hover:border-foreground/30"
            >
              {opt}
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
            {choicePicked === data.correct_choice_index
              ? "Correct."
              : `Better answer: "${data.choice_options[data.correct_choice_index]}"`}
          </div>
          <Button onClick={continueAfterChoice} className="w-full">
            Continue
          </Button>
        </div>
      )}

      {phase === "comprehension" && (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Comprehension {compIndex + 1} / {data.comprehension.length}
          </p>
          <p className="font-medium">{data.comprehension[compIndex].question}</p>
          <div className="space-y-2">
            {data.comprehension[compIndex].options.map((opt, i) => {
              const isCorrect = i === data.comprehension[compIndex].correct_index;
              const picked = compPicked === i;
              return (
                <button
                  key={i}
                  onClick={() => pickComp(i)}
                  disabled={compPicked !== null}
                  className={`block w-full rounded-xl border p-3 text-left text-sm transition-colors ${
                    compPicked === null
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
