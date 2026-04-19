import { useEffect, useState } from "react";
import type { Word } from "@/lib/db";
import { useServerFn } from "@tanstack/react-start";
import { generateMisusePair, gradeMisuseExplanation } from "@/lib/ai.functions";
import type { Grade } from "@/lib/srs";
import { StageBadge } from "../StageBadge";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Pair {
  target_word: string;
  target_meaning: string;
  sentences: { arabic: string; translation: string; is_correct: boolean }[];
  issue: string;
}

export function Stage4Cloze({
  word,
  onComplete,
}: {
  word: Word;
  onComplete: (grade: Grade) => void;
}) {
  const generate = useServerFn(generateMisusePair);
  const grade = useServerFn(gradeMisuseExplanation);
  const [data, setData] = useState<Pair | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickedIdx, setPickedIdx] = useState<number | null>(null);
  const [explanation, setExplanation] = useState("");
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<{ grade: "strong" | "adequate" | "weak"; feedback: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await generate({ data: { arabic: word.arabic, meaning: word.meaning } });
        if (alive) setData(r);
      } catch (e) {
        console.error(e);
        if (alive) setError("Could not generate exercise.");
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
        <p className="text-sm">Building usage check…</p>
      </div>
    );
  }

  const incorrectIdx = data.sentences.findIndex((s) => !s.is_correct);

  const submit = async () => {
    if (pickedIdx === null || !explanation.trim()) return;
    setGrading(true);
    try {
      const r = await grade({
        data: {
          targetWord: data.target_word,
          targetMeaning: data.target_meaning,
          incorrectSentence: data.sentences[incorrectIdx].arabic,
          groundTruthIssue: data.issue,
          userExplanation: explanation.trim(),
          pickedCorrectSentence: pickedIdx === incorrectIdx,
        },
      });
      setResult(r);
    } catch (e) {
      console.error(e);
      setResult({
        grade: pickedIdx === incorrectIdx ? "adequate" : "weak",
        feedback: "Couldn't grade automatically.",
      });
    } finally {
      setGrading(false);
    }
  };

  const proceed = () => {
    if (!result) return;
    const g: Grade =
      result.grade === "strong" ? "correct" : result.grade === "adequate" ? "partial" : "struggled";
    onComplete(g);
  };

  const colorMap: Record<string, string> = {
    strong: "border-success/40 bg-success/10 text-success",
    adequate: "border-stage-3/40 bg-stage-3/10",
    weak: "border-destructive/40 bg-destructive/10 text-destructive",
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <StageBadge stage={4} />
        <div className="arabic-quran text-2xl">{data.target_word}</div>
      </div>
      <p className="text-sm text-muted-foreground">
        One of these sentences uses the word <span className="arabic-quran">{data.target_word}</span> incorrectly.
        Pick it, then explain the mistake in your own words.
      </p>

      <ul className="space-y-3">
        {data.sentences.map((s, i) => {
          const picked = pickedIdx === i;
          const reveal = result !== null;
          const isWrong = !s.is_correct;
          return (
            <li key={i}>
              <button
                onClick={() => !result && setPickedIdx(i)}
                disabled={!!result}
                className={`block w-full rounded-xl border p-4 text-right transition-colors ${
                  reveal
                    ? isWrong
                      ? "border-destructive/60 bg-destructive/5"
                      : "border-success/60 bg-success/5"
                    : picked
                      ? "border-foreground bg-card"
                      : "border-border bg-card hover:border-foreground/30"
                }`}
                dir="rtl"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-md border border-border bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground" dir="ltr">
                    {String.fromCharCode(65 + i)}
                  </span>
                  {reveal && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        isWrong ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"
                      }`}
                      dir="ltr"
                    >
                      {isWrong ? "Misused" : "Correct"}
                    </span>
                  )}
                </div>
                <div className="arabic-quran mt-2 text-xl leading-loose">{s.arabic}</div>
                <div className="mt-1 text-left text-xs text-muted-foreground" dir="ltr">
                  {s.translation}
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <Textarea
        value={explanation}
        onChange={(e) => setExplanation(e.target.value)}
        placeholder="Explain in English what's wrong with the misused sentence."
        className="min-h-[120px]"
        disabled={!!result}
      />

      {result && (
        <div className={`rounded-xl border p-4 ${colorMap[result.grade]}`}>
          <div className="text-sm font-semibold uppercase tracking-wider">{result.grade}</div>
          <p className="mt-2 text-sm text-foreground/90">{result.feedback}</p>
          <p className="mt-3 text-xs text-foreground/70">
            <span className="font-semibold">The actual issue:</span> {data.issue}
          </p>
        </div>
      )}

      {!result ? (
        <Button
          onClick={submit}
          disabled={pickedIdx === null || !explanation.trim() || grading}
          className="w-full"
          size="lg"
        >
          {grading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Submit
        </Button>
      ) : (
        <Button onClick={proceed} className="w-full" size="lg">
          Continue
        </Button>
      )}
    </div>
  );
}
