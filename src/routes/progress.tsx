import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Interaction } from "@/lib/db";
import { useMemo } from "react";
import { Flame, BookOpenCheck, Activity, Trophy, ScrollText } from "lucide-react";

export const Route = createFileRoute("/progress")({
  head: () => ({
    meta: [
      { title: "Progress — Fahm" },
      {
        name: "description",
        content: "Your Quranic vocabulary mastery, by stage and deck.",
      },
    ],
  }),
  component: ProgressPage,
});

const STAGE_LABELS = ["Unseen", "Flashcard", "Context", "Listening", "Cloze", "Mastery"];

/** All 114 Surah names. Used for the "Quran coverage" map. */
const SURAH_NAMES: string[] = [
  "Al-Fatiha", "Al-Baqarah", "Al-Imran", "An-Nisa", "Al-Maidah",
  "Al-An'am", "Al-A'raf", "Al-Anfal", "At-Tawbah", "Yunus",
  "Hud", "Yusuf", "Ar-Ra'd", "Ibrahim", "Al-Hijr",
  "An-Nahl", "Al-Isra", "Al-Kahf", "Maryam", "Ta-Ha",
  "Al-Anbiya", "Al-Hajj", "Al-Mu'minun", "An-Nur", "Al-Furqan",
  "Ash-Shu'ara", "An-Naml", "Al-Qasas", "Al-Ankabut", "Ar-Rum",
  "Luqman", "As-Sajdah", "Al-Ahzab", "Saba", "Fatir",
  "Ya-Sin", "As-Saffat", "Sad", "Az-Zumar", "Ghafir",
  "Fussilat", "Ash-Shura", "Az-Zukhruf", "Ad-Dukhan", "Al-Jathiyah",
  "Al-Ahqaf", "Muhammad", "Al-Fath", "Al-Hujurat", "Qaf",
  "Adh-Dhariyat", "At-Tur", "An-Najm", "Al-Qamar", "Ar-Rahman",
  "Al-Waqi'ah", "Al-Hadid", "Al-Mujadila", "Al-Hashr", "Al-Mumtahanah",
  "As-Saff", "Al-Jumu'ah", "Al-Munafiqun", "At-Taghabun", "At-Talaq",
  "At-Tahrim", "Al-Mulk", "Al-Qalam", "Al-Haqqah", "Al-Ma'arij",
  "Nuh", "Al-Jinn", "Al-Muzzammil", "Al-Muddaththir", "Al-Qiyamah",
  "Al-Insan", "Al-Mursalat", "An-Naba", "An-Nazi'at", "Abasa",
  "At-Takwir", "Al-Infitar", "Al-Mutaffifin", "Al-Inshiqaq", "Al-Buruj",
  "At-Tariq", "Al-A'la", "Al-Ghashiyah", "Al-Fajr", "Al-Balad",
  "Ash-Shams", "Al-Layl", "Ad-Duha", "Ash-Sharh", "At-Tin",
  "Al-Alaq", "Al-Qadr", "Al-Bayyinah", "Az-Zalzalah", "Al-Adiyat",
  "Al-Qari'ah", "At-Takathur", "Al-Asr", "Al-Humazah", "Al-Fil",
  "Quraysh", "Al-Ma'un", "Al-Kawthar", "Al-Kafirun", "An-Nasr",
  "Al-Masad", "Al-Ikhlas", "Al-Falaq", "An-Nas",
];

function startOfDay(t: number) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function computeStreak(interactions: Interaction[]): number {
  if (interactions.length === 0) return 0;
  const days = new Set<number>();
  for (const i of interactions) days.add(startOfDay(i.timestamp));
  let streak = 0;
  let cursor = startOfDay(Date.now());
  // If user did nothing today, allow streak to start counting back from yesterday.
  if (!days.has(cursor)) cursor -= 86_400_000;
  while (days.has(cursor)) {
    streak++;
    cursor -= 86_400_000;
  }
  return streak;
}

/** Normalize "Surah Al-Fatiha" → "al-fatiha" for matching. */
function normalizeSurahKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/^surah\s+/i, "")
    .replace(/^surat\s+/i, "")
    .replace(/[''ʿʾ`]/g, "")
    .replace(/[\s_-]+/g, "-")
    .trim();
}

interface Achievement {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
}

function ProgressPage() {
  const decks = useLiveQuery(() => db.decks.toArray(), []);
  const stages = useLiveQuery(() => db.wordStages.toArray(), [], []);
  const interactions = useLiveQuery(() => db.interactions.toArray(), [], []);
  const words = useLiveQuery(() => db.words.toArray(), [], []);

  const stageCounts = useMemo(() => {
    const c = [0, 0, 0, 0, 0, 0];
    stages?.forEach((s) => c[s.currentStage]++);
    return c;
  }, [stages]);

  const totalWords = stages?.length ?? 0;
  const mastered = stageCounts[5];

  const today = startOfDay(Date.now());
  const todayInteractions = interactions?.filter((i) => i.timestamp >= today) ?? [];
  const reviewsToday = todayInteractions.length;
  const wordsStudiedToday = new Set(todayInteractions.map((i) => i.wordId)).size;
  const streak = useMemo(() => computeStreak(interactions ?? []), [interactions]);

  // Quran coverage: surah is "covered" if any deck domain matches its key.
  const coveredSurahs = useMemo(() => {
    const covered = new Set<string>();
    decks?.forEach((d) => {
      const key = normalizeSurahKey(d.domain ?? d.name);
      const match = SURAH_NAMES.find((s) => normalizeSurahKey(s) === key);
      if (match) covered.add(match);
    });
    return covered;
  }, [decks]);

  // Achievements (computed)
  const achievements: Achievement[] = useMemo(() => {
    const reachedStage = (s: number) => (stages ?? []).some((x) => x.currentStage >= s);
    const masteredCount = stageCounts[5];
    return [
      {
        id: "first-word",
        title: "First step",
        description: "Reached Stage 3 with your first word",
        unlocked: reachedStage(3),
      },
      {
        id: "first-mastery",
        title: "First mastery",
        description: "Mastered your first Quranic word",
        unlocked: masteredCount >= 1,
      },
      {
        id: "ten-mastered",
        title: "Decem",
        description: "Mastered 10 words",
        unlocked: masteredCount >= 10,
      },
      {
        id: "first-deck",
        title: "Deck builder",
        description: "Created or completed your first deck",
        unlocked: (decks ?? []).length >= 1,
      },
      {
        id: "streak-3",
        title: "Three-day glow",
        description: "Studied 3 days in a row",
        unlocked: streak >= 3,
      },
      {
        id: "streak-7",
        title: "Week of remembrance",
        description: "Studied 7 days in a row",
        unlocked: streak >= 7,
      },
    ];
  }, [stages, stageCounts, decks, streak]);

  // Recent reviews — last 12, joined with words
  const wordById = useMemo(() => {
    const m = new Map<number, (typeof words)[number] extends infer W ? W : never>();
    (words ?? []).forEach((w) => m.set(w.id!, w as never));
    return m;
  }, [words]);

  const recentReviews = useMemo(() => {
    const sorted = [...(interactions ?? [])].sort((a, b) => b.timestamp - a.timestamp);
    return sorted.slice(0, 12);
  }, [interactions]);

  return (
    <div className="space-y-10">
      {/* Header */}
      <section>
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Progress
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight">
          {mastered} mastered
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Across {totalWords} words and {interactions?.length ?? 0} total reviews.
        </p>
      </section>

      {/* Today bar */}
      <section className="grid grid-cols-3 gap-3">
        <StatCard
          label="Reviews today"
          value={reviewsToday}
          icon={<Activity className="h-4 w-4" />}
        />
        <StatCard
          label="Words studied"
          value={wordsStudiedToday}
          icon={<BookOpenCheck className="h-4 w-4" />}
        />
        <StatCard
          label="Day streak"
          value={streak}
          icon={<Flame className="h-4 w-4" />}
          accent={streak > 0}
        />
      </section>

      {/* By stage */}
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
                    className="h-full transition-all"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: `var(--stage-${stage})`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Quran coverage */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <h2 className="font-display text-lg font-semibold inline-flex items-center gap-2">
            <ScrollText className="h-4 w-4" /> Quran coverage
          </h2>
          <span className="text-xs text-muted-foreground tabular-nums">
            {coveredSurahs.size} / 114 surahs
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SURAH_NAMES.map((s, i) => {
            const covered = coveredSurahs.has(s);
            return (
              <span
                key={s}
                title={`${i + 1}. ${s}${covered ? " · covered" : ""}`}
                className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[10px] font-medium tabular-nums transition-colors ${
                  covered
                    ? "bg-foreground text-background"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                {i + 1}
              </span>
            );
          })}
        </div>
      </section>

      {/* Achievements */}
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold inline-flex items-center gap-2">
          <Trophy className="h-4 w-4" /> Achievements
        </h2>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {achievements.map((a) => (
            <li
              key={a.id}
              className={`rounded-xl border p-3 ${
                a.unlocked
                  ? "border-border bg-card"
                  : "border-border bg-card/40 opacity-60"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{a.title}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                    a.unlocked
                      ? "bg-success/15 text-success"
                      : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {a.unlocked ? "Unlocked" : "Locked"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{a.description}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Recent reviews */}
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Recent reviews</h2>
        {recentReviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No reviews yet — open a deck to start studying.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {recentReviews.map((r) => {
              const w = wordById.get(r.wordId);
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="arabic-quran text-right text-base" dir="rtl">
                      {w?.arabic ?? "—"}
                    </div>
                    <div className="truncate text-left text-xs text-muted-foreground" dir="ltr">
                      {w?.meaning ?? ""} · stage {r.stage}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                      r.correct
                        ? "bg-success/15 text-success"
                        : "bg-warning/20 text-warning-foreground"
                    }`}
                  >
                    {r.grade}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Decks */}
      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Decks</h2>
        <ul className="space-y-2">
          {decks?.map((d) => (
            <li key={d.id} className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="font-medium">{d.name}</div>
                <div className="text-xs text-muted-foreground">{d.wordCount} words</div>
              </div>
              <DeckProgressBar deckId={d.id!} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
        <span className={accent ? "text-accent" : ""}>{icon}</span>
      </div>
      <div className="mt-2 font-display text-3xl font-semibold tabular-nums tracking-tight">
        {value}
      </div>
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

  if (!data || data.total === 0) return null;
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
