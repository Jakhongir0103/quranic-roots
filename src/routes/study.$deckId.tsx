import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { db, type Word } from "@/lib/db";
import { applyStageOutcome, buildDueQueue, logInteraction, type Grade } from "@/lib/srs";
import { Stage1Flashcard } from "@/components/stages/Stage1Flashcard";
import { Stage2Context } from "@/components/stages/Stage2Context";
import { Stage3Listening } from "@/components/stages/Stage3Listening";
import { Stage4Cloze } from "@/components/stages/Stage4Cloze";
import { Stage5Interrogation } from "@/components/stages/Stage5Interrogation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, Sparkles } from "lucide-react";

export const Route = createFileRoute("/study/$deckId")({
  head: () => ({
    meta: [
      { title: "Study — Mizan" },
      { name: "description", content: "Active study session." },
    ],
  }),
  component: StudySession,
});

interface QueueItem {
  word: Word;
  stage: number;
}

function StudySession() {
  const { deckId } = Route.useParams();
  const id = Number(deckId);
  const navigate = useNavigate();
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [done, setDone] = useState(false);
  const [demoMode, setDemoMode] = useState(true);
  const [demoStage, setDemoStage] = useState(1);

  useEffect(() => {
    (async () => {
      const all = await buildDueQueue();
      const forDeck = all.filter((d) => d.word.deckId === id);
      // In demo mode, include all words from unlocked batches at every stage
      if (demoMode) {
        const batches = await db.batches.where({ deckId: id }).toArray();
        const unlockedWordIds = batches.filter((b) => b.unlocked).flatMap((b) => b.wordIds);
        const words = (await db.words.bulkGet(unlockedWordIds)).filter(Boolean) as Word[];
        const items = words.map((w) => ({ word: w, stage: 1 }));
        setQueue(items);
        return;
      }
      // Cap session length to keep things humane
      const items = forDeck.slice(0, 12).map((d) => ({ word: d.word, stage: d.row.stage }));
      if (items.length === 0) {
        setQueue([]);
      } else {
        setQueue(items);
      }
    })();
  }, [id, demoMode]);

  if (queue === null) {
    return <div className="text-muted-foreground">Loading session…</div>;
  }

  if (queue.length === 0) {
    return (
      <div className="space-y-6 text-center">
        <h1 className="font-display text-2xl font-semibold">Nothing due in this deck right now</h1>
        <p className="text-sm text-muted-foreground">
          Come back later — or open another deck.
        </p>
        <Button onClick={() => navigate({ to: "/" })}>Back to today</Button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="space-y-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
          <Check className="h-6 w-6" />
        </div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Session complete</h1>
        <p className="text-sm text-muted-foreground">
          You worked through {completed} item{completed === 1 ? "" : "s"}.
        </p>
        <div className="flex justify-center gap-2">
          <Button variant="secondary" onClick={() => navigate({ to: "/decks/$deckId", params: { deckId } })}>
            Deck details
          </Button>
          <Button onClick={() => navigate({ to: "/" })}>Back to today</Button>
        </div>
      </div>
    );
  }

  const current = queue[index];
  const activeStage = demoMode ? demoStage : current.stage;

  const advance = async (grade: Grade) => {
    const correct = ["correct", "partial", "strong", "adequate", "got_it"].includes(grade);
    await logInteraction({ wordId: current.word.id!, stage: activeStage, grade, correct });
    await applyStageOutcome(current.word.id!, activeStage, grade);
    setCompleted((c) => c + 1);
    if (demoMode) {
      // In demo mode, just move to next word at the selected stage
      if (index + 1 < queue.length) {
        setIndex(index + 1);
      } else {
        setDone(true);
      }
      return;
    }
    if (index + 1 < queue.length) {
      setIndex(index + 1);
    } else {
      setDone(true);
    }
  };

  const progress = ((index) / queue.length) * 100;

  return (
    <div className="-mt-2 min-h-[70vh]">
      <div className="mb-6 flex items-center justify-between">
        <button
          onClick={() => navigate({ to: "/decks/$deckId", params: { deckId } })}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Exit
        </button>
        <span className="text-xs tabular-nums text-muted-foreground">
          {index + 1} / {queue.length}
        </span>
      </div>
      <div className="mb-4 h-1 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full bg-accent transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mb-6 rounded-xl border border-dashed border-border bg-card/50 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="font-medium uppercase tracking-wider">Demo mode</span>
            <button
              onClick={() => setDemoMode((d) => !d)}
              className="ml-1 rounded-md border border-border px-2 py-0.5 text-[10px] hover:bg-secondary"
            >
              {demoMode ? "On" : "Off"}
            </button>
          </div>
          {demoMode && (
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => setDemoStage(s)}
                  className={`h-7 w-7 rounded-md text-xs font-medium tabular-nums transition-colors ${
                    demoStage === s
                      ? "bg-foreground text-background"
                      : "border border-border text-muted-foreground hover:bg-secondary"
                  }`}
                  title={`Stage ${s}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
        {demoMode && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Pick any stage to preview it for the current word. SRS scheduling is bypassed.
          </p>
        )}
      </div>

      {activeStage === 1 && <Stage1Flashcard key={`${current.word.id}-1-${demoStage}`} word={current.word} onComplete={advance} />}
      {activeStage === 2 && <Stage2Context key={`${current.word.id}-2-${demoStage}`} word={current.word} onComplete={advance} />}
      {activeStage === 3 && <Stage3Listening key={`${current.word.id}-3-${demoStage}`} word={current.word} onComplete={advance} />}
      {activeStage === 4 && <Stage4Cloze key={`${current.word.id}-4-${demoStage}`} word={current.word} onComplete={advance} />}
      {activeStage === 5 && <Stage5Interrogation key={`${current.word.id}-5-${demoStage}`} word={current.word} onComplete={advance} />}
    </div>
  );
}
