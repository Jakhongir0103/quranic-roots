import { useEffect, useState } from "react";
import type { Word } from "@/lib/db";
import { useServerFn } from "@tanstack/react-start";
import { generateCloze } from "@/lib/ai.functions";
import type { Grade } from "@/lib/srs";
import { StageBadge } from "../StageBadge";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function stripDiacritics(s: string) {
  return s.replace(/[\u064B-\u0652\u0670\u0640]/g, "").trim();
}

export function Stage4Cloze({
  word,
  onComplete,
}: {
  word: Word;
  onComplete: (grade: Grade) => void;
}) {
  const generate = useServerFn(generateCloze);
  const [data, setData] = useState<{ sentence: string; correct_answer: string; explanation: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<"correct" | "close" | "wrong" | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await generate({ data: { arabic: word.arabic, meaning: word.meaning } });
        if (alive) setData(r);
      } catch (e) {
        console.error(e);
        if (alive) setError("Could not generate cloze.");
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
        <p className="text-sm">Building cloze…</p>
      </div>
    );
  }

  const submit = () => {
    const a = answer.trim();
    if (!a) return;
    const exact = a === data.correct_answer;
    const stripped = stripDiacritics(a) === stripDiacritics(data.correct_answer);
    if (exact) setResult("correct");
    else if (stripped) setResult("close");
    else setResult("wrong");
  };

  const proceed = () => {
    if (!result) return;
    const grade: Grade = result === "correct" ? "correct" : result === "close" ? "partial" : "struggled";
    onComplete(grade);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <StageBadge stage={4} />
        <div className="arabic-quran text-2xl">{word.arabic}</div>
      </div>
      <p className="text-sm text-muted-foreground">Type the missing word in Arabic.</p>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="arabic-quran text-right text-2xl leading-loose" dir="rtl">
          {data.sentence.replace(/_+/g, "____")}
        </div>
      </div>

      <Input
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !result) submit();
        }}
        placeholder="Your answer"
        className="arabic text-right text-2xl"
        dir="rtl"
        disabled={!!result}
      />

      {result && (
        <div
          className={`rounded-xl border p-4 ${
            result === "correct"
              ? "border-success/40 bg-success/10 text-success"
              : result === "close"
                ? "border-warning/40 bg-warning/15"
                : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          <div className="text-sm font-semibold">
            {result === "correct" ? "Exactly right." : result === "close" ? "Right word, watch the diacritics." : "Not quite."}
          </div>
          <div className="mt-2 arabic-quran text-right text-xl text-foreground" dir="rtl">
            {data.correct_answer}
          </div>
          <p className="mt-2 text-sm text-foreground/80">{data.explanation}</p>
        </div>
      )}

      {!result ? (
        <Button onClick={submit} disabled={!answer.trim()} className="w-full" size="lg">
          Check
        </Button>
      ) : (
        <Button onClick={proceed} className="w-full" size="lg">
          Continue
        </Button>
      )}
    </div>
  );
}
