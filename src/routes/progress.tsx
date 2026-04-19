import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { useMemo } from "react";

export const Route = createFileRoute("/progress")({
  head: () => ({
    meta: [
      { title: "Progress — Mizan" },
      { name: "description", content: "Your Quranic vocabulary mastery, by stage and deck." },
    ],
  }),
  component: ProgressPage,
});

const STAGE_LABELS = ["Unseen", "Flashcard", "Context", "Listening", "Cloze", "Mastery"];

function ProgressPage() {
  const decks = useLiveQuery(() => db.decks.toArray(), []);
  const stages = useLiveQuery(() => db.wordStages.toArray(), [], []);
  const interactions = useLiveQuery(() => db.interactions.toArray(), [], []);

  const stageCounts = useMemo(() => {
    const c = [0, 0, 0, 0, 0, 0];
    stages?.forEach((s) => c[s.currentStage]++);
    return c;
  }, [stages]);

  const totalWords = stages?.length ?? 0;
  const mastered = stageCounts[5];
  const totalInteractions = interactions?.length ?? 0;

  return (
    <div className="space-y-8">
      <section>
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Progress
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
          {mastered} mastered
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Across {totalWords} words and {totalInteractions} interactions.
        </p>
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">By stage</h2>
        <div className="space-y-2">
          {stageCounts.map((count, stage) => {
            const pct = totalWords > 0 ? (count / totalWords) * 100 : 0;
            return (
              <div key={stage} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: `var(--stage-${stage})` }}
                    />
                    <span className="font-medium">
                      Stage {stage} · {STAGE_LABELS[stage]}
                    </span>
                  </div>
                  <span className="tabular-nums text-muted-foreground">{count}</span>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full"
                    style={{ width: `${pct}%`, backgroundColor: `var(--stage-${stage})` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Decks</h2>
        <ul className="space-y-2">
          {decks?.map((d) => {
            const deckWords = stages?.filter(() => true) ?? []; // all stages
            // Compute per-deck mastered: filter by joining with words isn't ideal;
            // just show wordCount + a rough bar based on global stages for now.
            return (
              <li key={d.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{d.name}</div>
                  <div className="text-xs text-muted-foreground">{d.wordCount} words</div>
                </div>
                <DeckProgressBar deckId={d.id!} />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

function DeckProgressBar({ deckId }: { deckId: number }) {
  const data = useLiveQuery(async () => {
    const ws = await db.words.where({ deckId }).toArray();
    const ids = ws.map((w) => w.id!);
    const sts = await db.wordStages.bulkGet(ids);
    const counts = [0, 0, 0, 0, 0, 0];
    sts.forEach((s) => {
      if (s) counts[s.currentStage]++;
    });
    return { counts, total: ws.length };
  }, [deckId]);

  if (!data) return null;
  return (
    <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      {data.counts.map((c, i) =>
        c > 0 ? (
          <div
            key={i}
            style={{ width: `${(c / data.total) * 100}%`, backgroundColor: `var(--stage-${i})` }}
          />
        ) : null,
      )}
    </div>
  );
}
