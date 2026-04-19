import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { db, type Word, type Deck } from "@/lib/db";
import { applyStageOutcome, buildDueQueue, logInteraction, type Grade } from "@/lib/srs";
import { generateDeckDialogue } from "@/lib/ai.functions";
import { dialogueKey, readDialogueCache, type DialogueData } from "@/lib/ai-preload";
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
      { title: "Study — Fahm" },
      { name: "description", content: "Active study session." },
    ],
  }),
  component: StudySession,
});

function StudySession() {
  const { deckId } = Route.useParams();
  const id = Number(deckId);
  const navigate = useNavigate();
  const generateDialogue = useServerFn(generateDeckDialogue);

  const [deck, setDeck] = useState<Deck | null>(null);
  const [batchWords, setBatchWords] = useState<Word[] | null>(null);
  // Stage-1 walks word-by-word; stages 2-5 act on the whole batch as one session.
  const [stage1Index, setStage1Index] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [done, setDone] = useState(false);
  const [demoMode, setDemoMode] = useState(true);
  const [demoStage, setDemoStage] = useState(1);
  // For deck-level stages, we cycle through one word per "iteration" of stages 4 (per-word misuse).
  const [perWordIndex, setPerWordIndex] = useState(0);

  useEffect(() => {
    (async () => {
      const d = await db.decks.get(id);
      setDeck(d ?? null);
      if (demoMode) {
        const batches = await db.batches.where({ deckId: id }).toArray();
        const unlockedWordIds = batches.filter((b) => b.unlocked).flatMap((b) => b.wordIds);
        const words = (await db.words.bulkGet(unlockedWordIds)).filter(Boolean) as Word[];
        setBatchWords(words);
        return;
      }
      // Real (SRS) mode: pick the next due batch's worth of words from this deck.
      const due = await buildDueQueue();
      const forDeck = due.filter((d) => d.word.deckId === id);
      if (forDeck.length === 0) {
        setBatchWords([]);
        return;
      }
      // Group by batch; take first batch with any due items
      const byBatch = new Map<number, Word[]>();
      for (const item of forDeck) {
        const arr = byBatch.get(item.word.batchNumber) ?? [];
        arr.push(item.word);
        byBatch.set(item.word.batchNumber, arr);
      }
      const firstBatch = [...byBatch.keys()].sort((a, b) => a - b)[0];
      // Always use ALL words from that batch for deck-wide stages
      const allInBatch = await db.words
        .where({ deckId: id, batchNumber: firstBatch })
        .toArray();
      setBatchWords(allInBatch);
    })();
  }, [id, demoMode]);

  // Reset per-stage cursors when stage changes
  useEffect(() => {
    setStage1Index(0);
    setPerWordIndex(0);
  }, [demoStage, demoMode]);

  const activeStage = demoStage; // demo mode is the only flow surfaced for now

  const currentStage1Word = useMemo(
    () => (batchWords && batchWords.length > 0 ? batchWords[stage1Index % batchWords.length] : null),
    [batchWords, stage1Index],
  );
  const currentPerWord = useMemo(
    () => (batchWords && batchWords.length > 0 ? batchWords[perWordIndex % batchWords.length] : null),
    [batchWords, perWordIndex],
  );
  const dialoguePayload = useMemo(
    () => batchWords?.map((w) => ({ arabic: w.arabic, meaning: w.meaning })) ?? [],
    [batchWords],
  );

  // Opportunistically warm Stage 3 while the learner is in earlier stages.
  useEffect(() => {
    if (dialoguePayload.length === 0) return;
    const key = dialogueKey(dialoguePayload, deck?.name);
    void readDialogueCache(
      key,
      () =>
        generateDialogue({
          data: { words: dialoguePayload, deckName: deck?.name },
        }) as Promise<DialogueData>,
    ).catch((error) => {
      console.warn("Dialogue preload failed", error);
    });
  }, [dialoguePayload, deck?.name, generateDialogue]);

  if (batchWords === null) {
    return <div className="text-muted-foreground">Loading session…</div>;
  }

  if (batchWords.length === 0) {
    return (
      <div className="space-y-6 text-center">
        <h1 className="font-display text-2xl font-semibold">Nothing due in this deck right now</h1>
        <p className="text-sm text-muted-foreground">Come back later — or open another deck.</p>
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
          <Button
            variant="secondary"
            onClick={() => navigate({ to: "/decks/$deckId", params: { deckId } })}
          >
            Deck details
          </Button>
          <Button onClick={() => navigate({ to: "/" })}>Back to today</Button>
        </div>
      </div>
    );
  }

  const finishStage = () => setDone(true);

  // Stage 1 handler: word-by-word, advance through whole batch, then mark done
  const onStage1 = async (g: Grade) => {
    const w = currentStage1Word;
    if (w) {
      await logInteraction({ wordId: w.id!, stage: 1, grade: g, correct: g === "got_it" });
      await applyStageOutcome(w.id!, 1, g);
    }
    setCompleted((c) => c + 1);
    if (stage1Index + 1 < batchWords.length) {
      setStage1Index(stage1Index + 1);
    } else {
      finishStage();
    }
  };

  // Stage 2 / 3 handler: deck-wide single session — one outcome applied to all words
  const onDeckStage = (stageNum: 2 | 3) => async (g: Grade) => {
    for (const w of batchWords) {
      await logInteraction({
        wordId: w.id!,
        stage: stageNum,
        grade: g,
        correct: g === "correct" || g === "partial",
      });
      await applyStageOutcome(w.id!, stageNum, g);
    }
    setCompleted((c) => c + batchWords.length);
    finishStage();
  };

  // Stage 4: per-word misuse — cycle through the batch
  const onStage4 = async (g: Grade) => {
    const w = currentPerWord;
    if (w) {
      await logInteraction({
        wordId: w.id!,
        stage: 4,
        grade: g,
        correct: g === "correct",
      });
      await applyStageOutcome(w.id!, 4, g);
    }
    setCompleted((c) => c + 1);
    if (perWordIndex + 1 < batchWords.length) {
      setPerWordIndex(perWordIndex + 1);
    } else {
      finishStage();
    }
  };

  // Stage 5: deck-wide conversation — one outcome applied to all words
  const onStage5 = async (g: Grade) => {
    for (const w of batchWords) {
      await logInteraction({
        wordId: w.id!,
        stage: 5,
        grade: g,
        correct: g === "strong" || g === "adequate",
      });
      await applyStageOutcome(w.id!, 5, g);
    }
    setCompleted((c) => c + batchWords.length);
    finishStage();
  };

  // Progress ratio depends on stage
  const progressRatio =
    activeStage === 1
      ? stage1Index / batchWords.length
      : activeStage === 4
        ? perWordIndex / batchWords.length
        : 0;
  const progress = progressRatio * 100;

  const positionLabel =
    activeStage === 1
      ? `${stage1Index + 1} / ${batchWords.length}`
      : activeStage === 4
        ? `${perWordIndex + 1} / ${batchWords.length}`
        : `Batch · ${batchWords.length} words`;

  return (
    <div className="-mt-2 min-h-[70vh]">
      <div className="mb-6 flex items-center justify-between">
        <button
          onClick={() => navigate({ to: "/decks/$deckId", params: { deckId } })}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Exit
        </button>
        <span className="text-xs tabular-nums text-muted-foreground">{positionLabel}</span>
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
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((s) => (
              <button
                key={s}
                onClick={() => {
                  setDemoStage(s);
                  setDone(false);
                  setCompleted(0);
                }}
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
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Stages 2, 3, and 5 use the whole batch in one session. Stages 1 and 4 cycle word by word.
        </p>
      </div>

      {activeStage === 1 && currentStage1Word && (
        <Stage1Flashcard
          key={`s1-${currentStage1Word.id}`}
          word={currentStage1Word}
          onComplete={onStage1}
        />
      )}
      {activeStage === 2 && (
        <Stage2Context key={`s2-${id}-${batchWords.length}`} words={batchWords} onComplete={onDeckStage(2)} />
      )}
      {activeStage === 3 && (
        <Stage3Listening
          key={`s3-${id}-${batchWords.length}`}
          words={batchWords}
          deckName={deck?.name}
          onComplete={onDeckStage(3)}
        />
      )}
      {activeStage === 4 && currentPerWord && (
        <Stage4Cloze key={`s4-${currentPerWord.id}`} word={currentPerWord} onComplete={onStage4} />
      )}
      {activeStage === 5 && (
        <Stage5Interrogation
          key={`s5-${id}-${batchWords.length}`}
          words={batchWords}
          onComplete={onStage5}
        />
      )}
    </div>
  );
}
