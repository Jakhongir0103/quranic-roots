import { useEffect, useState } from "react";
import type { Word } from "@/lib/db";
import { Button } from "@/components/ui/button";
import type { Grade } from "@/lib/srs";
import { StageBadge } from "../StageBadge";
import { useServerFn } from "@tanstack/react-start";
import { generateVerseExamples } from "@/lib/ai.functions";
import { Loader2 } from "lucide-react";

interface Verse {
  arabic: string;
  reference: string;
  translation: string;
}

export function Stage1Flashcard({
  word,
  onComplete,
}: {
  word: Word;
  onComplete: (grade: Grade) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const fetchVerses = useServerFn(generateVerseExamples);
  const [verses, setVerses] = useState<Verse[] | null>(null);
  const [versesError, setVersesError] = useState(false);

  // Lazy-load verses only after the user reveals the meaning
  useEffect(() => {
    if (!flipped || verses || versesError) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetchVerses({ data: { arabic: word.arabic, meaning: word.meaning } });
        if (alive) setVerses(r.verses);
      } catch (e) {
        console.error(e);
        if (alive) setVersesError(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [flipped, fetchVerses, word.arabic, word.meaning, verses, versesError]);

  return (
    <div className="space-y-6">
      <StageBadge stage={1} />
      <div
        className="flip-card mx-auto h-80 w-full max-w-md cursor-pointer"
        onClick={() => setFlipped((f) => !f)}
      >
        <div className={`flip-inner ${flipped ? "flipped" : ""}`}>
          {/* Front: Arabic only */}
          <div className="flip-face flex flex-col items-center justify-center rounded-3xl border border-border bg-card p-8 shadow-sm">
            <div className="flex min-h-40 items-center justify-center">
              <div className="arabic-quran text-center text-6xl leading-[2.3] text-foreground sm:text-7xl" dir="rtl">
                {word.arabic}
              </div>
            </div>
            <p className="mt-10 text-xs uppercase tracking-[0.22em] text-muted-foreground">
              Tap to reveal
            </p>
          </div>

          {/* Back: English meaning */}
          <div className="flip-face flip-back flex flex-col items-center justify-center rounded-3xl border border-border bg-card p-6 text-center shadow-sm">
            <div className="font-display text-4xl font-semibold tracking-tight">{word.meaning}</div>
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
        <div className="space-y-4">
          {/* Verse examples */}
          <section className="space-y-3">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              In the Quran
            </h3>
            {!verses && !versesError && (
              <div className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-card/40 p-4 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading verses…
              </div>
            )}
            {versesError && (
              <p className="rounded-xl border border-dashed border-border bg-card/40 p-4 text-xs text-muted-foreground">
                Couldn't load verse examples right now.
              </p>
            )}
            {verses && (
              <ul className="space-y-2">
                {verses.map((v, i) => (
                  <li key={i} className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {v.reference}
                      </span>
                    </div>
                    <div className="arabic-quran mt-1 text-right text-lg leading-loose" dir="rtl">
                      {v.arabic}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{v.translation}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              size="lg"
              onClick={() => onComplete("tricky")}
              className="rounded-xl"
            >
              Tricky
            </Button>
            <Button size="lg" onClick={() => onComplete("got_it")} className="rounded-xl">
              Got it
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
