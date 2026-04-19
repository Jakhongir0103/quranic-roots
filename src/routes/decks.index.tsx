import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { ArrowRight, BookOpen, Sparkles } from "lucide-react";

export const Route = createFileRoute("/decks/")({
  head: () => ({
    meta: [
      { title: "Decks — Mizan" },
      { name: "description", content: "Browse preset Quranic decks or create your own." },
    ],
  }),
  component: DecksIndex,
});

function DecksIndex() {
  const decks = useLiveQuery(() => db.decks.toArray(), []);

  return (
    <div className="space-y-8">
      <section>
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Decks
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
          Choose a starting point
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A deck is a curated set of words. You'll study them in batches of seven.
        </p>
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Preset</h2>
        <ul className="space-y-2">
          {decks
            ?.filter((d) => d.type === "preset")
            .map((d) => (
              <li key={d.id}>
                <Link
                  to="/decks/$deckId"
                  params={{ deckId: String(d.id) }}
                  className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-4 transition-colors hover:border-foreground/20"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-surface p-2">
                      <BookOpen className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-medium">{d.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.wordCount} words · curated
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Custom</h2>
        <ul className="space-y-2">
          {decks
            ?.filter((d) => d.type === "custom")
            .map((d) => (
              <li key={d.id}>
                <Link
                  to="/decks/$deckId"
                  params={{ deckId: String(d.id) }}
                  className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-4 transition-colors hover:border-foreground/20"
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
        <Link
          to="/decks/new"
          className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Sparkles className="h-4 w-4" /> Create custom deck
        </Link>
      </section>
    </div>
  );
}
