import Dexie, { type Table } from "dexie";

export type DeckType = "preset" | "custom";

export interface Deck {
  id?: number;
  name: string;
  type: DeckType;
  domain: string; // e.g., "Surah Al-Fatiha"
  wordCount: number;
  createdAt: number;
}

export interface Word {
  id?: number;
  deckId: number;
  arabic: string;
  meaning: string;
  partOfSpeech: string;
  frequencyNote?: string;
  usageNote?: string;
  batchNumber: number; // 1-indexed
  orderInBatch: number;
}

export interface WordStage {
  wordId: number;
  currentStage: number; // 0..5 (0 = unseen, 5 = mastered)
  stageHistory: { stage: number; at: number; grade: string }[];
  lastUpdated: number;
}

export interface SrsScheduleRow {
  id?: number; // composite would be ideal; use compound index
  wordId: number;
  stage: number;
  dueDate: number;
  interval: number; // hours
  easeFactor: number;
  lastReview: number | null;
  lastGrade: string | null;
}

export interface Interaction {
  id?: number;
  wordId: number;
  stage: number;
  correct: boolean;
  grade: string;
  responseTime: number;
  hintUsed: boolean;
  timestamp: number;
}

export interface Batch {
  id?: number;
  deckId: number;
  batchNumber: number;
  wordIds: number[];
  unlocked: boolean;
  allReachedStage3: boolean;
}

export interface Achievement {
  id?: number;
  type: string;
  deckId?: number;
  unlockedAt: number;
}

export interface UserSetting {
  key: string;
  value: unknown;
}

export class FahmDB extends Dexie {
  decks!: Table<Deck, number>;
  words!: Table<Word, number>;
  wordStages!: Table<WordStage, number>;
  srsSchedule!: Table<SrsScheduleRow, number>;
  interactions!: Table<Interaction, number>;
  batches!: Table<Batch, number>;
  achievements!: Table<Achievement, number>;
  userSettings!: Table<UserSetting, string>;

  constructor() {
    super("fahm");
    this.version(1).stores({
      decks: "++id, name, type, createdAt",
      words: "++id, deckId, batchNumber",
      wordStages: "wordId, currentStage",
      srsSchedule: "++id, &[wordId+stage], dueDate, wordId",
      interactions: "++id, wordId, stage, timestamp",
      batches: "++id, &[deckId+batchNumber], deckId, unlocked",
      achievements: "++id, type, deckId",
      userSettings: "key",
    });
  }
}

export const db = new FahmDB();

export const BATCH_SIZE = 7;
