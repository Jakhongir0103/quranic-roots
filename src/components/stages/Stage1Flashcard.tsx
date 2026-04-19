import { useState } from "react";
import type { Word } from "@/lib/db";
import { Button } from "@/components/ui/button";
import type { Grade } from "@/lib/srs";
import { StageBadge } from "../StageBadge";

export function Stage1Flashcard({
  word,
  onComplete,
}: {
  word: Word;
  onComplete: (grade: Grade) => void;
}) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div className="space-y-6">
      <StageBadge stage={1} />
      <div
        className="flip-card mx-auto h-80 w-full max-w-md cursor-pointer"
        onClick={() => setFlipped((f) => !f)}
      >
        <div className={`flip-inner ${flipped ? "flipped" : ""}`}>
          <div className="flip-face flex flex-col items-center justify-center rounded-3xl border border-border bg-card p-8 shadow-sm">
            <div className="arabic-quran text-6xl text-foreground sm:text-7xl">{word.arabic}</div>
            <p className="mt-6 text-xs uppercase tracking-[0.22em] text-muted-foreground">
              Tap to reveal
            </p>
          </div>
          <div className="flip-back flex flex-col items-center justify-center rounded-3xl border border-border bg-card p-8 text-center shadow-sm">
            <div className="arabic-quran text-3xl text-muted-foreground">{word.arabic}</div>
            <div className="mt-4 font-display text-3xl font-semibold tracking-tight">
              {word.meaning}
            </div>
            <div className="mt-2 text-xs uppercase tracking-wider text-muted-foreground">
              {word.partOfSpeech}
            </div>
            {word.usageNote && (
              <p className="mt-4 max-w-sm text-sm text-foreground/80">{word.usageNote}</p>
            )}
            {word.frequencyNote && (
              <p className="mt-3 text-xs text-muted-foreground">{word.frequencyNote}</p>
            )}
          </div>
        </div>
      </div>

      {flipped && (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" size="lg" onClick={() => onComplete("tricky")} className="rounded-xl">
            Tricky
          </Button>
          <Button size="lg" onClick={() => onComplete("got_it")} className="rounded-xl">
            Got it
          </Button>
        </div>
      )}
    </div>
  );
}
