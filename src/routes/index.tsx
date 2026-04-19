import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo } from "react";
import { db } from "@/lib/db";
import { buildDueQueue } from "@/lib/srs";
import { Button } from "@/components/ui/button";
import { ArrowRight, Sparkles, Library } from "lucide-react";

export const Route = createFileRoute("/")({
  loader: () => {
    throw redirect({ to: '/decks' })
  },
  head: () => ({
    meta: [
      { title: "Today — Mizan" },
      { name: "description", content: "Your due Quranic vocabulary reviews for today." },
    ],
  }),
  component: HomePage,
});

const STAGE_LABELS = ["Unseen", "Flashcard", "Context", "Listening", "Cloze", "Mastery"];

function HomePage() {
  const navigate = useNavigate();
  const decks = useLiveQuery(() => db.decks.toArray(), []);
  const dueItems = useLiveQuery(() => buildDueQueue(), [], []);

  const breakdown = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0];
    dueItems?.forEach((d) => {
      counts[d.row.stage]++;
    });
    return counts;
  }, [dueItems]);

  const totalDue = dueItems?.length ?? 0;
  const firstDeckId = decks?.[0]?.id;

  // First-time onboarding hint
  useEffect(() => {
    if (decks && decks.length === 0) {
      navigate({ to: "/decks" });
    }
  }, [decks, navigate]);

  const startStudy = () => {
    if (firstDeckId) navigate({ to: "/study/$deckId", params: { deckId: String(firstDeckId) } });
  };

  return (
    <div className="space-y-8">
      <section>
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Today
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
          {totalDue > 0 ? `${totalDue} word${totalDue === 1 ? "" : "s"} due` : "All caught up"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {totalDue > 0
            ? "Move them through their next stage."
            : "Come back later for your scheduled reviews — or open a deck to introduce new words."}
        </p>
      </section>

      {totalDue > 0 && (
        <section className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {breakdown.map((count, stage) =>
              count > 0 ? (
                <div
                  key={stage}
                  className="rounded-xl bg-surface px-3 py-2.5"
                  style={{ borderLeft: `3px solid var(--stage-${stage})` }}
                >
                  <div className="text-2xl font-display font-semibold tabular-nums">{count}</div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    {STAGE_LABELS[stage]}
                  </div>
                </div>
              ) : null,
            )}
          </div>
          <Button onClick={startStudy} className="mt-5 w-full rounded-xl" size="lg">
            Begin review <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Your decks</h2>
        {decks && decks.length > 0 ? (
          <ul className="space-y-2">
            {decks.map((d) => (
              <li key={d.id}>
                <Link
                  to="/decks/$deckId"
                  params={{ deckId: String(d.id) }}
                  className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-foreground/20"
                >
                  <div>
                    <div className="font-medium">{d.name}</div>
                    <div className="text-xs text-muted-foreground">{d.wordCount} words</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Loading…
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Link
            to="/decks"
            className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium transition-colors hover:border-foreground/20"
          >
            <Library className="h-4 w-4" /> Browse
          </Link>
          <Link
            to="/decks/new"
            className="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Sparkles className="h-4 w-4" /> Create custom
          </Link>
        </div>
      </section>
    </div>
  );
}
