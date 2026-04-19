import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { db } from "@/lib/db";
import { initializeDeck } from "@/lib/srs";
import { validateAndEnrichWord } from "@/lib/ai.functions";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/decks/new")({
  head: () => ({
    meta: [
      { title: "New deck — Mizan" },
      { name: "description", content: "Create a custom Quranic vocabulary deck." },
    ],
  }),
  component: NewDeckPage,
});

interface DraftWord {
  arabic: string;
  meaning: string;
  partOfSpeech: string;
  usageNote: string;
}

function NewDeckPage() {
  const navigate = useNavigate();
  const validate = useServerFn(validateAndEnrichWord);
  const [name, setName] = useState("");
  const [input, setInput] = useState("");
  const [words, setWords] = useState<DraftWord[]>([]);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);

  const addWord = async () => {
    const word = input.trim();
    if (!word) return;
    setValidating(true);
    try {
      const r = await validate({ data: { word } });
      if (!r.valid) {
        toast.error("That doesn't look like an Arabic word.");
        return;
      }
      setWords((ws) => [
        ...ws,
        { arabic: r.arabic, meaning: r.meaning, partOfSpeech: r.partOfSpeech, usageNote: r.usageNote },
      ]);
      setInput("");
    } catch (e) {
      console.error(e);
      // Fallback: accept raw input so user is never blocked
      setWords((ws) => [...ws, { arabic: word, meaning: "—", partOfSpeech: "—", usageNote: "" }]);
      setInput("");
      toast.warning("Saved without AI enrichment.");
    } finally {
      setValidating(false);
    }
  };

  const removeWord = (i: number) => {
    setWords((ws) => ws.filter((_, idx) => idx !== i));
  };

  const save = async () => {
    if (!name.trim() || words.length === 0) {
      toast.error("Add a name and at least one word.");
      return;
    }
    setSaving(true);
    try {
      const deckId = await db.decks.add({
        name: name.trim(),
        type: "custom",
        domain: "Custom",
        wordCount: words.length,
        createdAt: Date.now(),
      });
      let order = 0;
      for (const w of words) {
        await db.words.add({
          deckId,
          arabic: w.arabic,
          meaning: w.meaning,
          partOfSpeech: w.partOfSpeech,
          usageNote: w.usageNote,
          batchNumber: Math.floor(order / 7) + 1,
          orderInBatch: order % 7,
        });
        order++;
      }
      await initializeDeck(deckId);
      navigate({ to: "/decks/$deckId", params: { deckId: String(deckId) } });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Custom deck
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Build your deck</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Add Arabic words one at a time. We'll enrich each one with its meaning and grammar.
        </p>
      </section>

      <div className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Deck name
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Surah Al-Mulk core terms"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Arabic words
        </label>
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addWord();
              }
            }}
            placeholder="نَعْبُدُ"
            className="arabic text-right text-lg"
            dir="rtl"
            disabled={validating}
          />
          <Button onClick={addWord} disabled={validating || !input.trim()} className="shrink-0">
            {validating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {words.length > 0 && (
        <ul className="space-y-2">
          {words.map((w, i) => (
            <li
              key={i}
              className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card px-3 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="arabic-quran text-xl">{w.arabic}</div>
                <div className="text-sm">{w.meaning}</div>
                <div className="text-xs text-muted-foreground">{w.partOfSpeech}</div>
              </div>
              <button
                onClick={() => removeWord(i)}
                className="text-muted-foreground hover:text-destructive"
                aria-label="Remove word"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button
        onClick={save}
        disabled={saving || !name.trim() || words.length === 0}
        className="w-full rounded-xl"
        size="lg"
      >
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Save deck ({words.length} words)
      </Button>
    </div>
  );
}
