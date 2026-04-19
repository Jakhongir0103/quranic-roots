import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { ArrowRight, Lock, Plus } from "lucide-react";

export const Route = createFileRoute("/decks/$deckId")({
  head: ({ params }) => ({
    meta: [
      { title: `Deck — Mizan` },
      { name: "description", content: `Study deck ${params.deckId} in Mizan.` },
    ],
  }),
  component: DeckPreview,
});

function DeckPreview() {
  const { deckId } = Route.useParams();
  const id = Number(deckId);
  const navigate = useNavigate();
  const deck = useLiveQuery(() => db.decks.get(id), [id]);
  const words = useLiveQuery(() => db.words.where({ deckId: id }).toArray(), [id]);
  const batches = useLiveQuery(() => db.batches.where({ deckId: id }).toArray(), [id]);
  const stages = useLiveQuery(async () => {
    const all = await db.wordStages.toArray();
    return new Map(all.map((s) => [s.wordId, s.currentStage]));
  }, [words?.length]);

  if (!deck || !words) return <div className="text-muted-foreground">Loading…</div>;

  const grouped = new Map<number, typeof words>();
  words.forEach((w) => {
    const arr = grouped.get(w.batchNumber) ?? [];
    arr.push(w);
    grouped.set(w.batchNumber, arr);
  });

  return (
    <div className="space-y-8">
      <section>
        <Link to="/decks" className="text-xs text-muted-foreground hover:text-foreground">
          ← All decks
        </Link>
        <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          {deck.type === "preset" ? "Curated deck" : "Custom deck"}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{deck.name}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {deck.wordCount} words · studied in batches of 7. Each word travels through 5 stages
          independently.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            className="rounded-xl"
            size="lg"
            onClick={() => navigate({ to: "/study/$deckId", params: { deckId } })}
          >
            Begin study <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
          {deck.type === "custom" && (
            <Button
              variant="secondary"
              className="rounded-xl"
              size="lg"
              onClick={() => navigate({ to: "/decks/new", search: { deckId: id } })}
            >
              <Plus className="mr-2 h-4 w-4" /> Add more words
            </Button>
          )}
        </div>
      </section>

      {[...grouped.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([batchNum, ws]) => {
          const batch = batches?.find((b) => b.batchNumber === batchNum);
          const unlocked = batch?.unlocked ?? false;
          return (
            <section key={batchNum}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-display text-base font-semibold">
                  Batch {batchNum}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    · {ws.length} words
                  </span>
                </h2>
                {!unlocked && (
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <Lock className="h-3 w-3" /> Locked
                  </span>
                )}
              </div>
              <ul className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${unlocked ? "" : "opacity-40"}`}>
                {ws.map((w) => {
                  const stage = stages?.get(w.id!) ?? 0;
                  return (
                    <li
                      key={w.id}
                      className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2.5"
                    >
                      <div>
                        <div className="arabic-quran text-xl">{w.arabic}</div>
                        <div className="text-xs text-muted-foreground">{w.meaning}</div>
                      </div>
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: `var(--stage-${stage})` }}
                        title={`Stage ${stage}`}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
    </div>
  );
}
