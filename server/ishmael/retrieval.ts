import { CONCEPTS, CONCEPTS_BY_ID, type Concept } from "./concepts";
import { STAGE_ORDER, type LearnerState, type Stage } from "../../shared/ishmael";

/**
 * אחזור מושגים רלוונטיים לתור הנוכחי.
 *
 * זה לא חיפוש סמנטי ולא embeddings — בכוונה. גרף המושגים קטן ומובנה,
 * והתאמה לקסיקלית עם נורמליזציה עברית נותנת כאן תוצאות טובות יותר
 * מווקטורים, בלי תלות בשירות חיצוני ובלי זמן המתנה. מה שמוסיף דיוק
 * הוא לא הדמיון הטקסטואלי אלא *מבנה הגרף*: קרבה לשלב שבו השיחה
 * נמצאת, ותנאים מוקדמים שעדיין לא נתפסו.
 */

const NIQQUD = /[֑-ׇ]/g;

/** תחיליות עבריות נפוצות שכדאי לקלף לפני השוואה. */
const PREFIXES = ["וש", "כש", "מש", "לכ", "ה", "ו", "ב", "ל", "כ", "מ", "ש"];

export function normalizeToken(raw: string): string {
  const base = raw
    .toLowerCase()
    .replace(NIQQUD, "")
    .replace(/["'׳״]/g, "")
    .trim();

  // קילוף תחילית עברית — רק אם נשארת מילה בעלת אורך סביר, כדי
  // ש"ברית" לא יהפוך ל"רית".
  for (const p of PREFIXES) {
    if (base.startsWith(p) && base.length - p.length >= 3) {
      return base.slice(p.length);
    }
  }
  return base;
}

export function tokenize(text: string): string[] {
  return text
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(normalizeToken)
    .filter(t => t.length >= 2);
}

/** כל מונחי החיפוש של מושג, מנורמלים. */
function conceptTerms(c: Concept): string[][] {
  return [c.name, c.nameEn, ...c.aliases].map(a => tokenize(a));
}

/**
 * ניקוד התאמה בין טקסט המשתמש למושג יחיד.
 * ביטוי רב-מילים ששלם נמצא בטקסט שווה יותר ממילה בודדת.
 */
export function scoreConcept(tokens: string[], c: Concept): number {
  const set = new Set(tokens);
  let score = 0;

  for (const term of conceptTerms(c)) {
    if (term.length === 0) continue;
    const hits = term.filter(t => set.has(t)).length;
    if (hits === 0) continue;
    // ביטוי שלם: בונוס ריבועי לאורך. מילה בודדת מתוך ביטוי: חלקי.
    score += hits === term.length ? term.length * term.length : hits * 0.5;
  }

  return score * c.weight;
}

export type Retrieved = {
  concept: Concept;
  score: number;
  /** למה הוא נבחר — שימושי לניפוי שגיאות ולשקיפות */
  reason: "match" | "stage" | "prerequisite" | "next";
};

const stageIndex = (s: Stage) => STAGE_ORDER.indexOf(s);

/**
 * מחזיר את המושגים שצריכים להיות בהקשר של התור הבא.
 *
 * שלוש שכבות, לפי סדר עדיפות:
 *   1. מה שהאדם *הזכיר* (התאמה לקסיקלית)
 *   2. מה שהשלב הנוכחי עוסק בו (גם אם לא הוזכר)
 *   3. תנאים מוקדמים חסרים למה שנבחר — כי אי אפשר ללמד צומת
 *      שההורים שלו עדיין לא עומדים
 */
export function retrieveConcepts(
  text: string,
  learner: LearnerState,
  limit = 6
): Retrieved[] {
  const tokens = tokenize(text);
  const grasped = new Set(learner.grasped);
  const picked = new Map<string, Retrieved>();

  const add = (c: Concept, score: number, reason: Retrieved["reason"]) => {
    const existing = picked.get(c.id);
    if (!existing || existing.score < score) {
      picked.set(c.id, { concept: c, score, reason });
    }
  };

  // 1. התאמה ישירה
  const scored = CONCEPTS.map(c => ({ c, s: scoreConcept(tokens, c) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s);

  for (const { c, s } of scored.slice(0, limit)) {
    add(c, s, "match");
  }

  // 2. השלב הנוכחי — מה שהשיחה אמורה לעסוק בו עכשיו
  const here = stageIndex(learner.stage);
  for (const c of CONCEPTS) {
    if (stageIndex(c.stage) !== here) continue;
    if (grasped.has(c.id)) continue;
    add(c, c.weight, "stage");
  }

  // 3. סגירת תנאים מוקדמים
  const queue = [...picked.values()].map(r => r.concept);
  const seen = new Set(queue.map(c => c.id));
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const reqId of current.requires) {
      if (grasped.has(reqId) || seen.has(reqId)) continue;
      const req = CONCEPTS_BY_ID[reqId];
      if (!req) continue;
      seen.add(reqId);
      add(req, req.weight + 0.5, "prerequisite");
      queue.push(req);
    }
  }

  return [...picked.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit + 3);
}

/**
 * המושג הבא ללמד: הראשון בשלב הנוכחי שכל התנאים המוקדמים שלו כבר
 * נתפסו, והוא עצמו עדיין לא. זה מה שנותן למנוע כיוון גם כשהאדם
 * שואל משהו צדדי.
 */
export function nextTeachable(learner: LearnerState): Concept | null {
  const grasped = new Set(learner.grasped);
  const here = stageIndex(learner.stage);

  const ready = CONCEPTS.filter(
    c =>
      !grasped.has(c.id) &&
      stageIndex(c.stage) <= here &&
      c.requires.every(r => grasped.has(r))
  ).sort((a, b) => {
    const byStage = stageIndex(a.stage) - stageIndex(b.stage);
    return byStage !== 0 ? byStage : b.weight - a.weight;
  });

  return ready[0] ?? null;
}
