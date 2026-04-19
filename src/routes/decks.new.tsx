import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { db } from "@/lib/db";
import { initializeDeck } from "@/lib/srs";
import { validateAndEnrichWord, generateDeckFromPrompt } from "@/lib/ai.functions";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { X, Loader2, Plus, Sparkles, Save, MessageSquare, Pencil } from "lucide-react";
import { toast } from "sonner";

const searchSchema = z.object({
  deckId: z.coerce.number().optional(),
});

export const Route = createFileRoute("/decks/new")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "New deck — Fahm" },
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

type Mode = "manual" | "chat";

function NewDeckPage() {
  const navigate = useNavigate();
  const { deckId: editDeckId } = useSearch({ from: "/decks/new" });
  const validate = useServerFn(validateAndEnrichWord);
  const generateDeck = useServerFn(generateDeckFromPrompt);

  const isEditing = typeof editDeckId === "number";
  const [deckPersistedId, setDeckPersistedId] = useState<number | null>(editDeckId ?? null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("manual");

  // Manual entry
  const [input, setInput] = useState("");
  const [draftWords, setDraftWords] = useState<DraftWord[]>([]);
  const [validating, setValidating] = useState(false);
  const [savingWord, setSavingWord] = useState<number | null>(null);
  const [savedCount, setSavedCount] = useState(0);

  // Chat-based generation
  const [chatPrompt, setChatPrompt] = useState("");
  const [generating, setGenerating] = useState(false);

  // Load existing deck if editing
  useEffect(() => {
    if (!isEditing || editDeckId == null) return;
    (async () => {
      const d = await db.decks.get(editDeckId);
      if (!d) return;
      setName(d.name);
      const ws = await db.words.where({ deckId: editDeckId }).toArray();
      setSavedCount(ws.length);
    })();
  }, [isEditing, editDeckId]);

  // Ensure a deck row exists; returns its id.
  const ensureDeck = async (overrideName?: string, domain = "Custom"): Promise<number | null> => {
    if (deckPersistedId != null) return deckPersistedId;
    const finalName = (overrideName ?? name).trim();
    if (!finalName) {
      toast.error("Add a deck name first.");
      return null;
    }
    const id = (await db.decks.add({
      name: finalName,
      type: "custom",
      domain,
      wordCount: 0,
      createdAt: Date.now(),
    })) as number;
    setDeckPersistedId(id);
    return id;
  };

  const validateOne = async (raw: string): Promise<DraftWord | null> => {
    const word = raw.trim();
    if (!word) return null;
    try {
      const r = await validate({ data: { word } });
      if (!r.valid) return null;
      return {
        arabic: r.arabic,
        meaning: r.meaning,
        partOfSpeech: r.partOfSpeech,
        usageNote: r.usageNote,
      };
    } catch (e) {
      console.error(e);
      return { arabic: word, meaning: "—", partOfSpeech: "—", usageNote: "" };
    }
  };

  const addDraft = async () => {
    const word = input.trim();
    if (!word) return;
    setValidating(true);
    try {
      const w = await validateOne(word);
      if (!w) {
        toast.error("That doesn't look like an Arabic word.");
        return;
      }
      setDraftWords((ws) => [...ws, w]);
      setInput("");
    } finally {
      setValidating(false);
    }
  };

  const removeDraft = (i: number) => {
    setDraftWords((ws) => ws.filter((_, idx) => idx !== i));
  };

  // Persist a single draft word into the deck
  const saveOne = async (i: number) => {
    const w = draftWords[i];
    if (!w) return;
    setSavingWord(i);
    try {
      const id = await ensureDeck();
      if (id == null) return;
      const order = savedCount;
      await db.words.add({
        deckId: id,
        arabic: w.arabic,
        meaning: w.meaning,
        partOfSpeech: w.partOfSpeech,
        usageNote: w.usageNote,
        batchNumber: Math.floor(order / 7) + 1,
        orderInBatch: order % 7,
      });
      const newCount = savedCount + 1;
      setSavedCount(newCount);
      await db.decks.update(id, { wordCount: newCount });
      await initializeDeck(id);
      setDraftWords((ws) => ws.filter((_, idx) => idx !== i));
      toast.success(`Saved "${w.arabic}".`);
    } catch (e) {
      console.error(e);
      toast.error("Could not save word.");
    } finally {
      setSavingWord(null);
    }
  };

  // Save every draft word in sequence
  const saveAll = async () => {
    if (draftWords.length === 0) return;
    const id = await ensureDeck();
    if (id == null) return;
    let order = savedCount;
    for (const w of draftWords) {
      await db.words.add({
        deckId: id,
        arabic: w.arabic,
        meaning: w.meaning,
        partOfSpeech: w.partOfSpeech,
        usageNote: w.usageNote,
        batchNumber: Math.floor(order / 7) + 1,
        orderInBatch: order % 7,
      });
      order++;
    }
    setSavedCount(order);
    await db.decks.update(id, { wordCount: order });
    await initializeDeck(id);
    setDraftWords([]);
    toast.success(`Saved ${draftWords.length} word${draftWords.length === 1 ? "" : "s"}.`);
  };

  // Chat-based generation
  const generateFromChat = async () => {
    const p = chatPrompt.trim();
    if (!p) return;
    setGenerating(true);
    try {
      const r = await generateDeck({ data: { prompt: p } });
      if (!name.trim()) setName(r.deckName);
      const id = await ensureDeck(r.deckName, r.domain ?? "Custom");
      if (id == null) return;
      let order = savedCount;
      for (const w of r.words) {
        await db.words.add({
          deckId: id,
          arabic: w.arabic,
          meaning: w.meaning,
          partOfSpeech: w.partOfSpeech,
          usageNote: w.usageNote,
          batchNumber: Math.floor(order / 7) + 1,
          orderInBatch: order % 7,
        });
        order++;
      }
      setSavedCount(order);
      await db.decks.update(id, { wordCount: order });
      await initializeDeck(id);
      toast.success(`Generated ${r.words.length} words.`);
      setChatPrompt("");
    } catch (e) {
      console.error(e);
      toast.error("Could not generate deck. Try a more specific prompt.");
    } finally {
      setGenerating(false);
    }
  };

  const finish = () => {
    if (deckPersistedId == null) {
      toast.error("Add at least one word first.");
      return;
    }
    navigate({ to: "/decks/$deckId", params: { deckId: String(deckPersistedId) } });
  };

  return (
    <div className="space-y-6">
      <section>
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          {isEditing ? "Edit deck" : "Custom deck"}
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
          {isEditing ? (
            <span className="inline-flex items-center gap-2">
              <Pencil className="h-6 w-6" /> Add to deck
            </span>
          ) : (
            "Build your deck"
          )}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Add words one at a time, or describe what you want in plain English and let AI build the
          deck for you. Every word is saved individually — you can always come back and add more.
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
          disabled={deckPersistedId !== null}
        />
        {deckPersistedId !== null && (
          <p className="text-[11px] text-muted-foreground">
            Saved · {savedCount} word{savedCount === 1 ? "" : "s"} in deck
          </p>
        )}
      </div>

      {/* Mode tabs */}
      <div className="flex rounded-xl border border-border bg-card p-1">
        <button
          type="button"
          onClick={() => setMode("manual")}
          className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
            mode === "manual"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Pencil className="mr-1.5 inline h-3.5 w-3.5" /> Add words
        </button>
        <button
          type="button"
          onClick={() => setMode("chat")}
          className={`flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
            mode === "chat"
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <MessageSquare className="mr-1.5 inline h-3.5 w-3.5" /> Generate with AI
        </button>
      </div>

      {mode === "manual" && (
        <>
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Arabic word
            </label>
            <div className="flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addDraft();
                  }
                }}
                placeholder="نَعْبُدُ"
                className="arabic text-right text-lg"
                dir="rtl"
                disabled={validating}
              />
              <Button onClick={addDraft} disabled={validating || !input.trim()} className="shrink-0">
                {validating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Add as many as you want, then save them one by one or all at once.
            </p>
          </div>

          {draftWords.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Pending · {draftWords.length}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={saveAll}
                  disabled={savingWord !== null}
                >
                  <Save className="mr-1.5 h-3.5 w-3.5" /> Save all
                </Button>
              </div>
              <ul className="space-y-2">
                {draftWords.map((w, i) => (
                  <li
                    key={i}
                    className="flex items-start justify-between gap-3 rounded-xl border border-border bg-card px-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="arabic-quran text-xl">{w.arabic}</div>
                      <div className="text-sm">{w.meaning}</div>
                      <div className="text-xs text-muted-foreground">{w.partOfSpeech}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => saveOne(i)}
                        disabled={savingWord !== null}
                        title="Save this word"
                      >
                        {savingWord === i ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <Save className="mr-1 h-3.5 w-3.5" /> Save
                          </>
                        )}
                      </Button>
                      <button
                        onClick={() => removeDraft(i)}
                        className="p-1.5 text-muted-foreground hover:text-destructive"
                        aria-label="Remove word"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {mode === "chat" && (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Describe the deck
          </label>
          <Textarea
            value={chatPrompt}
            onChange={(e) => setChatPrompt(e.target.value)}
            placeholder={
              "e.g. The 20 most-occurring words in Surah Al-Baqarah\n\ne.g. Core vocabulary about divine mercy and forgiveness in the Quran"
            }
            className="min-h-[120px]"
            disabled={generating}
          />
          <Button
            onClick={generateFromChat}
            disabled={generating || !chatPrompt.trim()}
            className="w-full"
            size="lg"
          >
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" /> Generate deck
              </>
            )}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Generated words are added to your deck immediately. You can then add more by switching
            back to "Add words".
          </p>
        </div>
      )}

      <Button
        onClick={finish}
        disabled={deckPersistedId == null}
        className="w-full rounded-xl"
        size="lg"
        variant={deckPersistedId == null ? "secondary" : "default"}
      >
        {deckPersistedId == null
          ? "Save at least one word to continue"
          : `Open deck (${savedCount} word${savedCount === 1 ? "" : "s"})`}
      </Button>
    </div>
  );
}
