import { useEffect, useMemo, useState } from "react";
import type { Word } from "@/lib/db";
import { useServerFn } from "@tanstack/react-start";
import { generateDeckCloze } from "@/lib/ai.functions";
import type { Grade } from "@/lib/srs";
import { StageBadge } from "../StageBadge";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ClozeItem {
  arabic_word: string;
  sentence_before: string;
  sentence_after: string;
  translation: string;
}

interface Token {
  id: string;
  text: string;
  isDistractor: boolean;
}

function cleanClozeItems(items: ClozeItem[]) {
  return items.filter((item) => {
    const target = item.arabic_word.trim();
    const before = item.sentence_before.trim();
    const after = item.sentence_after.trim();
    return target && (before || after);
  });
}

export function Stage2Context({
  words,
  difficulty = 3,
  onComplete,
}: {
  words: Word[];
  difficulty?: number;
  onComplete: (grade: Grade) => void;
}) {
  const generate = useServerFn(generateDeckCloze);
  const [items, setItems] = useState<ClozeItem[] | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [error, setError] = useState<string | null>(null);
  // sentenceIndex -> token id
  const [placements, setPlacements] = useState<Record<number, string | null>>({});
  const [draggedToken, setDraggedToken] = useState<string | null>(null);
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [done, setDone] = useState(false);

  const wordPayload = useMemo(
    () => words.map((w) => ({ arabic: w.arabic, meaning: w.meaning })),
    [words],
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await generate({ data: { words: wordPayload, difficulty } });
        if (!alive) return;
        const validItems = cleanClozeItems(r.items);
        if (validItems.length === 0) throw new Error("EMPTY_CLOZE_ITEMS");
        setItems(validItems);
        const baseTokens: Token[] = validItems.map((it, i) => ({
          id: `t-${i}`,
          text: it.arabic_word,
          isDistractor: false,
        }));
        baseTokens.push({ id: "t-distractor", text: r.distractor, isDistractor: true });
        // shuffle
        setTokens([...baseTokens].sort(() => Math.random() - 0.5));
        setPlacements({});
      } catch (e) {
        console.error(e);
        if (alive) setError("Could not generate exercise.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [generate, wordPayload, difficulty]);

  if (error) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button onClick={() => onComplete("struggled")}>Skip</Button>
      </div>
    );
  }

  if (!items) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-sm">Building exercise from your deck…</p>
      </div>
    );
  }

  // Correct token id for sentence i is `t-${i}` (distractor never fits)
  const tryPlace = (sentenceIdx: number, tokenId: string) => {
    const token = tokens.find((t) => t.id === tokenId);
    const isCorrectToken = token?.text === items[sentenceIdx].arabic_word;
    if (isCorrectToken) {
      const next = { ...placements, [sentenceIdx]: tokenId };
      setPlacements(next);
      const allCorrect = items.every((item, i) => {
        const placed = tokens.find((t) => t.id === next[i]);
        return placed?.text === item.arabic_word;
      });
      if (allCorrect && !done) {
        setDone(true);
        const grade: Grade =
          wrongAttempts === 0 ? "correct" : wrongAttempts <= 2 ? "partial" : "struggled";
        setTimeout(() => onComplete(grade), 900);
      }
    } else {
      setWrongAttempts((w) => w + 1);
      const cell = document.getElementById(`drop-${sentenceIdx}`);
      cell?.animate(
        [
          { transform: "translateX(0)" },
          { transform: "translateX(-6px)" },
          { transform: "translateX(6px)" },
          { transform: "translateX(0)" },
        ],
        { duration: 250 },
      );
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <StageBadge stage={2} />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {Object.keys(placements).length} / {items.length} placed
        </span>
      </div>
      <p className="text-sm text-muted-foreground">
        Drag the right Arabic word into each blank. One word in the pool doesn't belong.
      </p>

      <ul className="space-y-3">
        {items.map((s, i) => {
          const placedId = placements[i];
          const placedToken = tokens.find((t) => t.id === placedId);
          const isCorrect = placedToken?.text === s.arabic_word;
          return (
            <li key={i} className="rounded-xl border border-border bg-card p-4">
              <div className="arabic-quran text-right text-xl leading-loose" dir="rtl">
                {s.sentence_before}{" "}
                <span
                  id={`drop-${i}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (draggedToken) tryPlace(i, draggedToken);
                    setDraggedToken(null);
                  }}
                  onClick={() => {
                    if (draggedToken) tryPlace(i, draggedToken);
                    setDraggedToken(null);
                  }}
                  className={`inline-block min-w-[5rem] rounded-md border-2 border-dashed px-3 py-0.5 align-middle text-base transition-colors ${
                    isCorrect
                      ? "border-success bg-success/10 text-success"
                      : "border-border bg-surface text-muted-foreground"
                  }`}
                >
                  {placedToken ? placedToken.text : "ـــــ"}
                </span>{" "}
                {s.sentence_after}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">{s.translation}</div>
            </li>
          );
        })}
      </ul>

      <div className="rounded-xl border border-dashed border-border bg-card/40 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          Word pool
        </div>
        <div className="flex flex-wrap gap-2">
          {tokens.map((t) => {
            const used = Object.values(placements).includes(t.id);
            return (
              <button
                key={t.id}
                draggable={!used}
                onDragStart={() => setDraggedToken(t.id)}
                onDragEnd={() => setDraggedToken(null)}
                onClick={() => setDraggedToken((cur) => (cur === t.id ? null : t.id))}
                disabled={used}
                className={`arabic-quran rounded-full border px-4 py-2 text-base transition-all ${
                  used
                    ? "border-border bg-muted text-muted-foreground line-through opacity-50"
                    : draggedToken === t.id
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-border bg-card hover:border-accent"
                }`}
                dir="rtl"
              >
                {t.text}
              </button>
            );
          })}
        </div>
      </div>
      {draggedToken && (
        <p className="text-center text-xs text-muted-foreground">
          Now tap the blank where this word belongs.
        </p>
      )}
    </div>
  );
}
