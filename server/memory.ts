import { invokeLLM } from "./_core/llm";
import { MEMORY_EXTRACTION_PROMPT } from "./prompt";
import {
  EMPTY_MEMORY,
  MEMORY_LIMITS,
  type JourneyMemory,
} from "../shared/merhav";

// מודל קטן וזול יותר, מספיק למשימת חילוץ רקע. אפשר לשנות דרך MEMORY_MODEL.
const MEMORY_MODEL = process.env.MEMORY_MODEL || "claude-haiku-4-5-20251001";
/**
 * המודל צורך טוקנים גם ל-reasoning, ולכן צריך תקרה נדיבה —
 * אחרת התשובה נחתכת באמצע וה-JSON נשבר.
 */
const MEMORY_MAX_TOKENS = 4000;
const MAX_ITEM_LENGTH = 180;

function cleanList(raw: unknown, limit: number): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of raw) {
    if (typeof item !== "string") continue;
    const value = item.trim().slice(0, MAX_ITEM_LENGTH);
    if (value.length === 0) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }

  // הפריטים החדשים חשובים יותר, ולכן נשמרים אלה שבסוף הרשימה
  return result.slice(-limit);
}

function cleanText(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().slice(0, MAX_ITEM_LENGTH) : "";
}

/** מנקה ומגביל זיכרון שהגיע מבחוץ — מהלקוח או מהמודל. */
export function normalizeMemory(raw: unknown): JourneyMemory {
  if (!raw || typeof raw !== "object") return { ...EMPTY_MEMORY };

  const source = raw as Record<string, unknown>;

  return {
    life: cleanList(source.life, MEMORY_LIMITS.life),
    themes: cleanList(source.themes, MEMORY_LIMITS.themes),
    strengths: cleanList(source.strengths, MEMORY_LIMITS.strengths),
    insights: cleanList(source.insights, MEMORY_LIMITS.insights),
    emotions: cleanList(source.emotions, MEMORY_LIMITS.emotions),
    values: cleanList(source.values, MEMORY_LIMITS.values),
    goals: cleanList(source.goals, MEMORY_LIMITS.goals),
    practice: cleanText(source.practice),
    lastFocus: cleanText(source.lastFocus),
  };
}

/**
 * הופך את הזיכרון להודעת מערכת שהמנוע קורא לפני שהוא עונה.
 * מחזיר null כשאין מה לספר, כדי שלא יתחזה להיכרות שלא קיימת.
 *
 * הסדר וההדגשות כאן לא מקריים: "ראיות לחוזק" ו"ערכים" מודגשים
 * במכוון, כי הם החומר שהעוזר אמור לשקף בחזרה כדי להעלות ביטחון
 * וערך עצמי — זו המטרה המרכזית של האפליקציה.
 */
export function buildMemoryContext(
  memory: JourneyMemory,
  isReturningVisit: boolean
): string | null {
  const sections: string[] = [];

  if (memory.life.length > 0) {
    sections.push(`החיים שלו: ${memory.life.join("; ")}`);
  }
  if (memory.themes.length > 0) {
    sections.push(`מה חוזר אצלו: ${memory.themes.join("; ")}`);
  }
  if (memory.emotions.length > 0) {
    sections.push(
      `רגשות שחוזרים אצלו, כפי שהוא עצמו תיאר: ${memory.emotions.join("; ")}`
    );
  }
  if (memory.strengths.length > 0) {
    sections.push(
      `ראיות לחוזק שהוא עצמו ספר (השתמש בהן כשמתאים, בעובדות ולא כשבחים): ${memory.strengths.join("; ")}`
    );
  }
  if (memory.values.length > 0) {
    sections.push(
      `מה שחשוב לו באמת, לפי מה שהוא עצמו סיפר (אפשר להראות לו איפה הוא כבר פועל לפי זה): ${memory.values.join("; ")}`
    );
  }
  if (memory.goals.length > 0) {
    sections.push(`לאן הוא רוצה להגיע (מטרות שהוא עצמו אישר): ${memory.goals.join("; ")} — אלה אמיתיות, לא ניחוש. תשתמש בהן באופן פעיל: שאל על התקדמות כשזה טבעי, קשר דברים שהוא מספר אליהן, ותראה לו איפה הוא כבר בדרך אליהן.`);
  }
  if (memory.insights.length > 0) {
    sections.push(`מה שהוא גילה על עצמו: ${memory.insights.join("; ")}`);
  }
  if (memory.practice.length > 0) {
    sections.push(`הדבר הקטן שהצעת לו בפעם הקודמת: ${memory.practice}`);
  }
  if (memory.lastFocus.length > 0) {
    sections.push(`במה עסקה השיחה הקודמת: ${memory.lastFocus}`);
  }

  if (sections.length === 0) return null;

  const guidance = isReturningVisit
    ? `זו חזרה שלו אחרי הפסקה. פתח בהתייחסות אמיתית ומדויקת למשהו מהרשימה — לא בפתיחה גנרית. אם הצעת לו משהו קטן לעשות, אפשר לשאול אם יצא לו, בלי לבדוק אותו ובלי להאשים אם לא.`
    : `השיחה נמשכת. השתמש במה שאתה יודע כדי לא לשאול שוב דברים שכבר ספר לך.`;

  return `מה שידוע עליו עד כה (מהשיחות הקודמות, לשימוש שלך בלבד — אל תציג את הרשימה הזאת ואל תאמר שיש לך "רשומות"):

${sections.join("\n")}

${guidance}`;
}

type ConversationTurn = { role: "user" | "assistant"; content: string };

/**
 * מחלץ זיכרון מעודכן מתוך השיחה. רץ אחרי שהתשובה נשלחה,
 * ולכן כישלון כאן לא פוגע בחוויה.
 */
export async function extractMemory(
  existing: JourneyMemory,
  turns: ConversationTurn[]
): Promise<JourneyMemory | null> {
  const transcript = turns
    .slice(-10)
    .map(t => `${t.role === "user" ? "אדם" : "מרחב"}: ${t.content}`)
    .join("\n");

  if (transcript.trim().length === 0) return null;

  try {
    const response = await invokeLLM({
      model: MEMORY_MODEL,
      max_tokens: MEMORY_MAX_TOKENS,
      messages: [
        { role: "system", content: MEMORY_EXTRACTION_PROMPT },
        {
          role: "user",
          content: `הזיכרון הקיים:\n${JSON.stringify(existing, null, 2)}\n\nקטע השיחה:\n${transcript}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "journey_memory",
          strict: true,
          schema: {
            type: "object",
            properties: {
              life: { type: "array", items: { type: "string" } },
              themes: { type: "array", items: { type: "string" } },
              strengths: { type: "array", items: { type: "string" } },
              insights: { type: "array", items: { type: "string" } },
              emotions: { type: "array", items: { type: "string" } },
              values: { type: "array", items: { type: "string" } },
              goals: { type: "array", items: { type: "string" } },
              practice: { type: "string" },
              lastFocus: { type: "string" },
            },
            required: [
              "life",
              "themes",
              "strengths",
              "insights",
              "emotions",
              "values",
              "goals",
              "practice",
              "lastFocus",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const raw = response.choices?.[0]?.message?.content;
    const content =
      typeof raw === "string"
        ? raw
        : Array.isArray(raw)
          ? raw
              .map(part =>
                part && typeof part === "object" && "text" in part
                  ? String((part as { text?: unknown }).text ?? "")
                  : ""
              )
              .join("")
          : "";

    if (content.trim().length === 0) return null;

    const cleaned = content.replace(/```json|```/g, "").trim();
    return normalizeMemory(JSON.parse(cleaned));
  } catch (error) {
    console.error("[memory] extraction failed:", error);
    return null;
  }
}
