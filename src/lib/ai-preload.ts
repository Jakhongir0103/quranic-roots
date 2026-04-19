export interface VerseExample {
  arabic: string;
  reference: string;
  translation: string;
}

export interface VerseExamplesData {
  verses: VerseExample[];
}

export interface DialogueExchange {
  speaker: "A" | "B";
  arabic: string;
  translation: string;
}

export interface DialogueData {
  topic: string;
  exchanges: DialogueExchange[];
  pause_after_index: number;
  choice_options_arabic: string[];
  choice_options_translation: string[];
  correct_choice_index: number;
  questions: {
    kind: "meaning" | "role";
    target_word: string;
    question: string;
    options: string[];
    correct_index: number;
  }[];
}

interface DialogueWord {
  arabic: string;
  meaning: string;
}

const verseExamplesCache = new Map<string, Promise<VerseExamplesData> | VerseExamplesData>();
const dialogueCache = new Map<string, Promise<DialogueData> | DialogueData>();

function readThroughCache<T>(
  cache: Map<string, Promise<T> | T>,
  key: string,
  load: () => Promise<T>,
) {
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = load().then(
    (value) => {
      cache.set(key, value);
      return value;
    },
    (error) => {
      cache.delete(key);
      throw error;
    },
  );

  cache.set(key, pending);
  return pending;
}

export function verseExamplesKey(arabic: string, meaning: string) {
  return `${arabic.trim()}::${meaning.trim()}`;
}

export function readVerseExamplesCache(key: string, load: () => Promise<VerseExamplesData>) {
  return readThroughCache(verseExamplesCache, key, load);
}

export function dialogueKey(words: DialogueWord[], deckName?: string, difficulty = 3) {
  const wordKey = words.map((word) => `${word.arabic.trim()}=${word.meaning.trim()}`).join("|");
  return `${deckName?.trim() ?? ""}::difficulty=${difficulty}::${wordKey}`;
}

export function readDialogueCache(key: string, load: () => Promise<DialogueData>) {
  return readThroughCache(dialogueCache, key, load);
}
