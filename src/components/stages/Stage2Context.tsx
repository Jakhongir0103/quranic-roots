import { useEffect, useState } from "react";
import type { Word } from "@/lib/db";
import { useServerFn } from "@tanstack/react-start";
import { generateContextSentences } from "@/lib/ai.functions";
import type { Grade } from "@/lib/srs";
import { StageBadge } from "../StageBadge";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Sentence {
  arabic: string;
  translation: string;
  meaning_tag: string;
}

export function Stage2Context({
  word,
  onComplete,
}: {
  word: Word;
  onComplete: (grade: Grade) => void;
}) {
  const generate = useServerFn(generateContextSentences);
  const [sentences, setSentences] = useState<Sentence[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // mapping: sentenceIndex -> tagIndex (correct = matching index)
  const [placements, setPlacements] = useState<Record<number, number | null>>({});
  const [shuffledTags, setShuffledTags] = useState<{ idx: number; text: string }[]>([]);
  const [draggedTag, setDraggedTag] = useState<number | null>(null);
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await generate({ data: { arabic: word.arabic, meaning: word.meaning } });
        if (!alive) return;
        setSentences(r.sentences);
        const tags = r.sentences.map((s, i) => ({ idx: i, text: s.meaning_tag }));
        setShuffledTags([...tags].sort(() => Math.random() - 0.5));
        setPlacements({});
      } catch (e) {
        console.error(e);
        if (alive) setError("Could not generate context sentences. Try again.");
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

  if (!sentences) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-sm">Crafting context sentences…</p>
      </div>
    );
  }

  const placeTag = (sentenceIdx: number, tagIdx: number) => {
    if (placements[sentenceIdx] === tagIdx) return;
    if (tagIdx === sentenceIdx) {
      const next = { ...placements, [sentenceIdx]: tagIdx };
      setPlacements(next);
      const allCorrect = sentences.every((_, i) => next[i] === i);
      if (allCorrect && !done) {
        setDone(true);
        const grade: Grade = wrongAttempts === 0 ? "correct" : wrongAttempts <= 2 ? "partial" : "struggled";
        setTimeout(() => onComplete(grade), 900);
      }
    } else {
      setWrongAttempts((w) => w + 1);
      // bounce: temporarily flash
      const cell = document.getElementById(`drop-${sentenceIdx}`);
      cell?.animate(
        [{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(6px)" }, { transform: "translateX(0)" }],
        { duration: 250 },
      );
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <StageBadge stage={2} />
        <div className="arabic-quran text-2xl">{word.arabic}</div>
      </div>
      <p className="text-sm text-muted-foreground">
        Drag each meaning to the sentence where it fits.
      </p>

      <ul className="space-y-3">
        {sentences.map((s, i) => {
          const placedTagIdx = placements[i];
          return (
            <li
              key={i}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="arabic-quran text-right text-xl leading-loose" dir="rtl">
                {s.arabic}
              </div>
              <div className="mt-2 text-sm text-muted-foreground">{s.translation}</div>
              <div
                id={`drop-${i}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (draggedTag !== null) placeTag(i, draggedTag);
                  setDraggedTag(null);
                }}
                onClick={() => {
                  if (draggedTag !== null) placeTag(i, draggedTag);
                  setDraggedTag(null);
                }}
                className={`mt-3 flex min-h-[42px] items-center justify-center rounded-lg border-2 border-dashed px-3 py-2 text-sm transition-colors ${
                  placedTagIdx === i
                    ? "border-success bg-success/10 text-success"
                    : "border-border bg-surface text-muted-foreground"
                }`}
              >
                {placedTagIdx !== null ? sentences[placedTagIdx]?.meaning_tag : "Drop meaning here"}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap gap-2">
        {shuffledTags.map((t) => {
          const used = Object.values(placements).includes(t.idx);
          return (
            <button
              key={t.idx}
              draggable={!used}
              onDragStart={() => setDraggedTag(t.idx)}
              onDragEnd={() => setDraggedTag(null)}
              onClick={() => setDraggedTag((cur) => (cur === t.idx ? null : t.idx))}
              disabled={used}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition-all ${
                used
                  ? "border-border bg-muted text-muted-foreground line-through opacity-50"
                  : draggedTag === t.idx
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border bg-card hover:border-accent"
              }`}
            >
              {t.text}
            </button>
          );
        })}
      </div>
      {draggedTag !== null && (
        <p className="text-center text-xs text-muted-foreground">
          Now tap the sentence it belongs to.
        </p>
      )}
    </div>
  );
}
