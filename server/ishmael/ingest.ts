import fs from "node:fs";
import path from "node:path";
import { tokenize } from "./retrieval";

/**
 * עיגון אופציונלי בטקסט שברשותך.
 *
 * הרפוזיטורי הזה לא מכיל — ולא יכיל — את טקסט ספריו של דניאל קווין.
 * הספרים מוגנים בזכויות יוצרים, ואתרים שמפיצים אותם בחינם עושים זאת
 * בלי רישיון. המנוע לכן בנוי כך שהוא עומד בזכות עצמו: גרף המושגים
 * ב-concepts.ts הוא ניסוח עצמאי של הרעיונות, וזה מה שמפעיל אותו.
 *
 * המודול הזה קיים בשביל מי שיש לו עותק חוקי משלו ורוצה שהמנוע יידע
 * *היכן* דבר נאמר. הוא:
 *   - קורא קבצי .txt מתיקייה מקומית בלבד (ברירת מחדל: ./corpus/),
 *     שנמצאת ב-.gitignore ולא נכנסת לגרסאות.
 *   - שולח למודל קטעים קצרים בלבד, כמצביע להקשר.
 *   - לא הופך את המנוע למכונת ציטוט: המדיניות בפרומפט נשארת "נסח
 *     מחדש, אל תעתיק".
 */

/** נקרא בזמן הקריאה ולא בזמן הטעינה, כדי שאפשר יהיה להחליף תיקייה בבדיקות. */
const corpusDir = () => process.env.ISHMAEL_CORPUS_DIR || path.resolve("corpus");

/** קטע יחיד — קצר בכוונה. זה מצביע, לא תחליף לספר. */
const CHUNK_CHARS = 700;
/** מה שבאמת נכנס לפרומפט מכל קטע. */
const EXCERPT_CHARS = 320;
const MAX_EXCERPTS = 3;

export type GroundingChunk = {
  /** מיקום יחסי בקובץ, כאחוז — מאפשר להפנות "בערך בשליש הראשון" */
  position: number;
  text: string;
  tokens: Set<string>;
};

export type GroundingDoc = {
  title: string;
  chunks: GroundingChunk[];
};

let cache: GroundingDoc[] | null = null;

function chunkText(raw: string): GroundingChunk[] {
  const clean = raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const chunks: GroundingChunk[] = [];

  for (let i = 0; i < clean.length; i += CHUNK_CHARS) {
    const text = clean.slice(i, i + CHUNK_CHARS);
    chunks.push({
      position: clean.length > 0 ? Math.round((i / clean.length) * 100) : 0,
      text,
      tokens: new Set(tokenize(text)),
    });
  }

  return chunks;
}

/** טוען פעם אחת ומחזיק בזיכרון. נכשל בשקט אם אין תיקייה — זה המצב הרגיל. */
export function loadGrounding(): GroundingDoc[] {
  if (cache) return cache;

  try {
    const dir = corpusDir();
    if (!fs.existsSync(dir)) {
      cache = [];
      return cache;
    }

    cache = fs
      .readdirSync(dir)
      .filter(f => f.toLowerCase().endsWith(".txt"))
      .map(file => ({
        title: path.basename(file, path.extname(file)),
        chunks: chunkText(fs.readFileSync(path.join(dir, file), "utf8")),
      }));
  } catch (error) {
    console.warn("ishmael grounding unavailable:", error);
    cache = [];
  }

  return cache;
}

/** לבדיקות ולטעינה מחדש אחרי שינוי בתיקייה. */
export function resetGroundingCache() {
  cache = null;
}

/**
 * מוצא את הקטעים הרלוונטיים לשאלה. חפיפת אסימונים פשוטה — מספיקה
 * למטרה, שהיא הפניה ולא אחזור מדויק.
 */
export function findExcerpts(
  docs: GroundingDoc[],
  query: string,
  limit = MAX_EXCERPTS
): Array<{ title: string; position: number; excerpt: string; score: number }> {
  const q = tokenize(query);
  if (q.length === 0) return [];

  const hits: Array<{ title: string; position: number; excerpt: string; score: number }> = [];

  for (const doc of docs) {
    for (const chunk of doc.chunks) {
      const overlap = q.filter(t => chunk.tokens.has(t)).length;
      if (overlap < 2) continue;
      hits.push({
        title: doc.title,
        position: chunk.position,
        excerpt: chunk.text.slice(0, EXCERPT_CHARS),
        score: overlap / q.length,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** בונה את שכבת ההקשר. מחזיר null כשאין קורפוס — המצב הרגיל. */
export function renderGrounding(docs: GroundingDoc[], query: string): string | null {
  if (docs.length === 0 || !query.trim()) return null;

  const excerpts = findExcerpts(docs, query);
  if (excerpts.length === 0) return null;

  return (
    `## עיגון בקורפוס המקומי\n` +
    `הקטעים הבאים באים מעותק שברשות המשתמש, והם כאן כדי שתדע *היכן* הדבר\n` +
    `נדון — לא כדי שתעתיק אותם. נסח בקולך, ואם אתה מפנה, הפנה לשם היצירה\n` +
    `ולמיקום המשוער. אל תצטט יותר ממשפט קצר, ואם אתה עושה זאת — סמן שזה ציטוט.\n\n` +
    excerpts
      .map(e => `— ${e.title}, בערך ${e.position}% לתוך הטקסט:\n${e.excerpt}`)
      .join("\n\n")
  );
}
