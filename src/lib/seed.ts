import { db } from "./db";
import { initializeDeck } from "./srs";

/**
 * Al-Fatiha curated word list — high-frequency, Quran-central vocabulary.
 * Diacritics included.
 */
const AL_FATIHA_WORDS = [
  { arabic: "بِسْمِ", meaning: "in the name of", partOfSpeech: "preposition + noun", frequencyNote: "Opens every Surah but one", usageNote: "Used to begin actions in God's name." },
  { arabic: "اللَّهِ", meaning: "Allah / God", partOfSpeech: "proper noun", frequencyNote: "Most frequent word in the Quran (~2,700)", usageNote: "The unique proper name of the One God." },
  { arabic: "الرَّحْمَٰنِ", meaning: "the Most Merciful", partOfSpeech: "adjective", frequencyNote: "Appears ~57 times", usageNote: "Mercy as an essential attribute, broad in scope." },
  { arabic: "الرَّحِيمِ", meaning: "the Especially Merciful", partOfSpeech: "adjective", frequencyNote: "~115 times", usageNote: "Mercy expressed in continuous action." },
  { arabic: "الْحَمْدُ", meaning: "praise / all praise", partOfSpeech: "noun", frequencyNote: "Praise rooted in gratitude", usageNote: "Used to ascribe praise wholly to God." },
  { arabic: "رَبِّ", meaning: "Lord / Sustainer", partOfSpeech: "noun", frequencyNote: "Over 900 occurrences", usageNote: "Implies ownership, nurture, and authority." },
  { arabic: "الْعَالَمِينَ", meaning: "the worlds / all that exists", partOfSpeech: "noun (plural)", frequencyNote: "~73 times", usageNote: "All realms of creation." },
  { arabic: "مَالِكِ", meaning: "Master / Owner", partOfSpeech: "active participle", frequencyNote: "Recited in every prayer", usageNote: "Absolute authority and possession." },
  { arabic: "يَوْمِ", meaning: "Day", partOfSpeech: "noun", frequencyNote: "Most often refers to the Day of Judgment", usageNote: "Marker of time, especially eschatological." },
  { arabic: "الدِّينِ", meaning: "the Recompense / Religion", partOfSpeech: "noun", frequencyNote: "~92 times", usageNote: "Both 'religion' and 'judgment' depending on context." },
  { arabic: "إِيَّاكَ", meaning: "You alone", partOfSpeech: "pronoun (object, fronted)", frequencyNote: "Emphatic exclusivity", usageNote: "Fronting the object emphasizes 'You alone, not another.'" },
  { arabic: "نَعْبُدُ", meaning: "we worship", partOfSpeech: "verb (1st pl.)", frequencyNote: "Root ع-ب-د is foundational", usageNote: "Worship as total servitude and devotion." },
  { arabic: "نَسْتَعِينُ", meaning: "we seek help", partOfSpeech: "verb (1st pl.)", frequencyNote: "Form X (seeking)", usageNote: "Active appeal for divine aid." },
  { arabic: "اهْدِنَا", meaning: "guide us", partOfSpeech: "verb (imperative)", frequencyNote: "From root ه-د-ي", usageNote: "Request for guidance, both initial and continuous." },
  { arabic: "الصِّرَاطَ", meaning: "the path / way", partOfSpeech: "noun", frequencyNote: "~45 times", usageNote: "A clear, established road." },
  { arabic: "الْمُسْتَقِيمَ", meaning: "the straight / upright", partOfSpeech: "active participle", frequencyNote: "Often paired with صراط", usageNote: "What is upright, balanced, without deviation." },
  { arabic: "أَنْعَمْتَ", meaning: "You have favored / blessed", partOfSpeech: "verb (2nd sg.)", frequencyNote: "Root ن-ع-م", usageNote: "Bestowal of grace upon someone." },
  { arabic: "عَلَيْهِمْ", meaning: "upon them", partOfSpeech: "preposition + pronoun", frequencyNote: "Common construction", usageNote: "Direction of action onto a group." },
  { arabic: "الْمَغْضُوبِ", meaning: "those upon whom is wrath", partOfSpeech: "passive participle", frequencyNote: "Single Quranic occurrence", usageNote: "Those who knew truth and rejected it." },
  { arabic: "الضَّالِّينَ", meaning: "the astray", partOfSpeech: "active participle (pl.)", frequencyNote: "Root ض-ل-ل", usageNote: "Those who lost the path through ignorance." },
  { arabic: "غَيْرِ", meaning: "other than / not", partOfSpeech: "noun (excepting)", frequencyNote: "Common excluder", usageNote: "Marks exclusion or contrast." },
];

export async function seedAlFatihaIfNeeded() {
  const existing = await db.decks.where({ name: "Surah Al-Fatiha" }).first();
  if (existing) return existing.id!;

  const deckId = await db.decks.add({
    name: "Surah Al-Fatiha",
    type: "preset",
    domain: "Surah Al-Fatiha",
    wordCount: AL_FATIHA_WORDS.length,
    createdAt: Date.now(),
  });

  let order = 0;
  for (const w of AL_FATIHA_WORDS) {
    const batchNumber = Math.floor(order / 7) + 1;
    const orderInBatch = order % 7;
    await db.words.add({
      deckId,
      arabic: w.arabic,
      meaning: w.meaning,
      partOfSpeech: w.partOfSpeech,
      frequencyNote: w.frequencyNote,
      usageNote: w.usageNote,
      batchNumber,
      orderInBatch,
    });
    order++;
  }

  await initializeDeck(deckId);
  return deckId;
}

export async function ensureSeed() {
  await seedAlFatihaIfNeeded();
}
