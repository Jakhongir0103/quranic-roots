import { useEffect, useState } from "react";
import type { Word } from "@/lib/db";
import { useServerFn } from "@tanstack/react-start";
import { generateChallenge, gradeResponse } from "@/lib/ai.functions";
import type { Grade } from "@/lib/srs";
import { StageBadge } from "../StageBadge";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface Challenge {
  challenge_type: string;
  question: string;
  ideal_elements: string[];
  rubric: string;
}

export function Stage5Interrogation({
  word,
  onComplete,
}: {
  word: Word;
  onComplete: (grade: Grade) => void;
}) {
  const genChallenge = useServerFn(generateChallenge);
  const grade = useServerFn(gradeResponse);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState("");
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState<{ grade: "strong" | "adequate" | "weak"; feedback: string } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await genChallenge({ data: { arabic: word.arabic, meaning: word.meaning } });
        if (alive) setChallenge(r);
      } catch (e) {
        console.error(e);
        if (alive) setError("Could not generate challenge.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [genChallenge, word.arabic, word.meaning]);

  if (error) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button onClick={() => onComplete("weak")}>Skip</Button>
      </div>
    );
  }
  if (!challenge) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-sm">Preparing challenge…</p>
      </div>
    );
  }

  const submit = async () => {
    if (!response.trim()) return;
    setGrading(true);
    try {
      const r = await grade({
        data: {
          question: challenge.question,
          idealElements: challenge.ideal_elements,
          rubric: challenge.rubric,
          response: response.trim(),
        },
      });
      setResult(r);
    } catch (e) {
      console.error(e);
      setResult({ grade: "adequate", feedback: "Couldn't grade automatically; logged as adequate." });
    } finally {
      setGrading(false);
    }
  };

  const proceed = () => {
    if (!result) return;
    onComplete(result.grade);
  };

  const colorMap = {
    strong: "border-success/40 bg-success/10 text-success",
    adequate: "border-stage-3/40 bg-stage-3/10",
    weak: "border-destructive/40 bg-destructive/10 text-destructive",
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <StageBadge stage={5} />
        <div className="arabic-quran text-2xl">{word.arabic}</div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {challenge.challenge_type.replace(/_/g, " ")}
        </div>
        <p className="mt-2 text-base font-medium">{challenge.question}</p>
      </div>

      <Textarea
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        placeholder="Write your answer in English…"
        className="min-h-[140px]"
        disabled={!!result || grading}
      />

      {result && (
        <div className={`rounded-xl border p-4 ${colorMap[result.grade]}`}>
          <div className="text-sm font-semibold uppercase tracking-wider">{result.grade}</div>
          <p className="mt-2 text-sm text-foreground/90">{result.feedback}</p>
        </div>
      )}

      {!result ? (
        <Button onClick={submit} disabled={!response.trim() || grading} className="w-full" size="lg">
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
