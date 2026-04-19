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
import { ArrowLeft, Check } from "lucide-react";

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

  useEffect(() => {
    (async () => {
      const all = await buildDueQueue();
      const forDeck = all.filter((d) => d.word.deckId === id);
      // Cap session length to keep things humane
      const items = forDeck.slice(0, 12).map((d) => ({ word: d.word, stage: d.row.stage }));
      if (items.length === 0) {
        setQueue([]);
      } else {
        setQueue(items);
      }
    })();
  }, [id]);

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

  const advance = async (grade: Grade) => {
    const correct = ["correct", "partial", "strong", "adequate", "got_it"].includes(grade);
    await logInteraction({ wordId: current.word.id!, stage: current.stage, grade, correct });
    await applyStageOutcome(current.word.id!, current.stage, grade);
    setCompleted((c) => c + 1);
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
      <div className="mb-6 h-1 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full bg-accent transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {current.stage === 1 && <Stage1Flashcard key={`${current.word.id}-1`} word={current.word} onComplete={advance} />}
      {current.stage === 2 && <Stage2Context key={`${current.word.id}-2`} word={current.word} onComplete={advance} />}
      {current.stage === 3 && <Stage3Listening key={`${current.word.id}-3`} word={current.word} onComplete={advance} />}
      {current.stage === 4 && <Stage4Cloze key={`${current.word.id}-4`} word={current.word} onComplete={advance} />}
      {current.stage === 5 && <Stage5Interrogation key={`${current.word.id}-5`} word={current.word} onComplete={advance} />}
    </div>
  );
}
