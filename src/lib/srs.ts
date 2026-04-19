import { db, BATCH_SIZE, type Word } from "./db";

export type Grade = "wrong" | "struggled" | "partial" | "correct" | "strong" | "adequate" | "weak" | "tricky" | "got_it";

const HOUR = 60 * 60 * 1000;

/** Initial intervals per stage (hours) when first scheduled. */
function initialIntervalForStage(stage: number, grade: Grade): number {
  switch (stage) {
    case 1: // after flashcard, schedule stage 2
      return grade === "tricky" ? 4 : 24;
    case 2: // after context, schedule stage 3
      if (grade === "correct") return 48;
      if (grade === "partial") return 24;
      return 8; // struggled — stays at 2
    case 3:
      if (grade === "correct") return 72;
      if (grade === "partial") return 48;
      return 12;
    case 4:
      if (grade === "correct") return 96;
      if (grade === "partial") return 48;
      return 24;
    case 5:
      if (grade === "strong") return 30 * 24;
      if (grade === "adequate") return 14 * 24;
      return 48; // weak — regress
    default:
      return 24;
  }
}

/** Map a stage outcome to whether the word advances to the next stage. */
export function passesStage(stage: number, grade: Grade): boolean {
  if (stage === 1) return true;
  if (stage === 2 || stage === 3) return grade === "correct" || grade === "partial";
  if (stage === 4) return grade === "correct";
  if (stage === 5) return grade === "strong" || grade === "adequate";
  return false;
}

export async function logInteraction(params: {
  wordId: number;
  stage: number;
  grade: Grade;
  correct: boolean;
  responseTime?: number;
}) {
  await db.interactions.add({
    wordId: params.wordId,
    stage: params.stage,
    grade: params.grade,
    correct: params.correct,
    responseTime: params.responseTime ?? 0,
    hintUsed: false,
    timestamp: Date.now(),
  });
}

/** After a stage interaction: update WordStage, schedule next SRS row, check batch unlock. */
export async function applyStageOutcome(wordId: number, stage: number, grade: Grade) {
  const now = Date.now();
  const wordStage = (await db.wordStages.get(wordId)) ?? {
    wordId,
    currentStage: 1,
    stageHistory: [],
    lastUpdated: now,
  };

  // Mark current SRS row as reviewed
  const currentRow = await db.srsSchedule.where({ wordId, stage }).first();
  if (currentRow) {
    await db.srsSchedule.update(currentRow.id!, {
      lastReview: now,
      lastGrade: grade,
    });
  }

  let nextStage = wordStage.currentStage;

  if (passesStage(stage, grade)) {
    nextStage = Math.min(5, stage + 1);
    // Stage 5 strong/adequate = "mastered" — schedule next stage 5 review (long-term)
    if (stage === 5) {
      await scheduleStage(wordId, 5, initialIntervalForStage(5, grade));
    } else {
      await scheduleStage(wordId, nextStage, initialIntervalForStage(stage, grade));
    }
  } else {
    // Failed — stays in stage, sooner review
    if (stage === 5 && grade === "weak") {
      // Regress to stage 4
      nextStage = 4;
      await scheduleStage(wordId, 4, initialIntervalForStage(5, "weak"));
    } else {
      await scheduleStage(wordId, stage, initialIntervalForStage(stage, grade));
    }
  }

  wordStage.currentStage = Math.max(wordStage.currentStage, nextStage);
  wordStage.stageHistory.push({ stage, at: now, grade });
  wordStage.lastUpdated = now;
  await db.wordStages.put(wordStage);

  await checkBatchUnlock(wordId);
}

async function scheduleStage(wordId: number, stage: number, intervalHours: number) {
  const due = Date.now() + intervalHours * HOUR;
  const existing = await db.srsSchedule.where({ wordId, stage }).first();
  if (existing) {
    await db.srsSchedule.update(existing.id!, {
      dueDate: due,
      interval: intervalHours,
    });
  } else {
    await db.srsSchedule.add({
      wordId,
      stage,
      dueDate: due,
      interval: intervalHours,
      easeFactor: 2.5,
      lastReview: null,
      lastGrade: null,
    });
  }
}

export async function checkBatchUnlock(wordId: number) {
  const word = await db.words.get(wordId);
  if (!word) return;
  const batch = await db.batches.where({ deckId: word.deckId, batchNumber: word.batchNumber }).first();
  if (!batch || batch.allReachedStage3) return;
  const stages = await db.wordStages.bulkGet(batch.wordIds);
  const allAtStage3 = stages.every((s) => s && s.currentStage >= 3);
  if (allAtStage3) {
    await db.batches.update(batch.id!, { allReachedStage3: true });
    // Unlock next batch
    const next = await db.batches
      .where({ deckId: word.deckId, batchNumber: word.batchNumber + 1 })
      .first();
    if (next) {
      await db.batches.update(next.id!, { unlocked: true });
    }
  }
}

/** Build the due queue across all decks. */
export async function buildDueQueue(now = Date.now()) {
  const due = await db.srsSchedule.where("dueDate").belowOrEqual(now).toArray();
  // Only include words from unlocked batches
  const wordIds = [...new Set(due.map((d) => d.wordId))];
  const words = await db.words.bulkGet(wordIds);
  const wordMap = new Map<number, Word>();
  words.forEach((w) => w && wordMap.set(w.id!, w));

  const batchKeys = [...new Set(words.filter(Boolean).map((w) => `${w!.deckId}:${w!.batchNumber}`))];
  const batchMap = new Map<string, boolean>();
  for (const key of batchKeys) {
    const [deckId, batchNumber] = key.split(":").map(Number);
    const b = await db.batches.where({ deckId, batchNumber }).first();
    batchMap.set(key, b?.unlocked ?? false);
  }

  return due
    .filter((row) => {
      const w = wordMap.get(row.wordId);
      if (!w) return false;
      return batchMap.get(`${w.deckId}:${w.batchNumber}`);
    })
    .sort((a, b) => a.dueDate - b.dueDate)
    .map((row) => ({ row, word: wordMap.get(row.wordId)! }));
}

/** Initialize a deck: create batches and seed Stage 0 for all words. */
export async function initializeDeck(deckId: number) {
  const words = await db.words.where({ deckId }).sortBy("id");
  const numBatches = Math.ceil(words.length / BATCH_SIZE);
  for (let b = 1; b <= numBatches; b++) {
    const slice = words.slice((b - 1) * BATCH_SIZE, b * BATCH_SIZE);
    const existing = await db.batches.where({ deckId, batchNumber: b }).first();
    if (!existing) {
      await db.batches.add({
        deckId,
        batchNumber: b,
        wordIds: slice.map((w) => w.id!),
        unlocked: b === 1,
        allReachedStage3: false,
      });
    }
    for (const w of slice) {
      const ws = await db.wordStages.get(w.id!);
      if (!ws) {
        await db.wordStages.put({
          wordId: w.id!,
          currentStage: 0,
          stageHistory: [],
          lastUpdated: Date.now(),
        });
      }
      // Schedule Stage 1 immediately for batch 1 only
      if (b === 1) {
        const has = await db.srsSchedule.where({ wordId: w.id!, stage: 1 }).first();
        if (!has) {
          await db.srsSchedule.add({
            wordId: w.id!,
            stage: 1,
            dueDate: Date.now(),
            interval: 0,
            easeFactor: 2.5,
            lastReview: null,
            lastGrade: null,
          });
        }
      }
    }
  }
}
