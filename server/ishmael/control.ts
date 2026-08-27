import { TONES, type Gender, type Tone } from "../../shared/ishmael";

/**
 * שורת הבקרה.
 *
 * כל תשובה של המודל נפתחת בשורה אחת שאינה מוצגת למשתמש:
 *
 *   ⟦tone:curious|reveal:hold|name:טל|gender:male|age:34⟧
 *
 * למה בראש ולא בסוף: ההנפשה צריכה להתחיל *עם* המילים הראשונות ולא
 * אחרי שהמשפט נגמר. טון שמגיע בסוף התשובה הוא טון שאיחר.
 *
 * למה מנגנון אחד לכל הערכים: טון, בקשת התגלות ופרטי זהות הם כולם
 * "מה המודל יודע ברגע הזה". שלושה מנגנונים נפרדים היו שלוש נקודות
 * כשל במקום אחת.
 */

export type Control = {
  tone?: Tone;
  /** המודל מבקש להתגלות. השרת מחליט אם לאשר. */
  revealRequested?: boolean;
  name?: string;
  gender?: Gender;
  age?: number;
};

const OPEN = "⟦";
const CLOSE = "⟧";
/** אחרי כמות התווים הזו בלי סוגר — מניחים שאין שורת בקרה בכלל. */
const GIVE_UP_AFTER = 240;

export function parseControlLine(raw: string): Control {
  const control: Control = {};

  for (const pair of raw.split("|")) {
    const idx = pair.indexOf(":");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim().toLowerCase();
    const value = pair.slice(idx + 1).trim();
    if (!value) continue;

    switch (key) {
      case "tone":
        if ((TONES as string[]).includes(value)) control.tone = value as Tone;
        break;
      case "reveal":
        control.revealRequested = value.toLowerCase() === "now";
        break;
      case "name":
        // שם ולא משפט: אורך סביר ולא יותר משתי מילים
        if (value.length <= 40 && value.split(/\s+/).length <= 2) {
          control.name = value;
        }
        break;
      case "gender":
        if (value === "male" || value === "female") control.gender = value;
        break;
      case "age": {
        const n = Number.parseInt(value, 10);
        if (Number.isFinite(n) && n >= 5 && n <= 120) control.age = n;
        break;
      }
    }
  }

  return control;
}

export type ParserOutput = { control: Control | null; text: string };

/**
 * מפרסר זורם. הטקסט מגיע ברסיסים, ושורת הבקרה עלולה להיחתך באמצע —
 * לכן הוא צובר עד שהסוגר מגיע, ורק אז משחרר. אם לא הגיע סוגר בזמן
 * סביר, הכל משוחרר כטקסט רגיל: תשובה בלי שורת בקרה עדיפה על תשובה
 * שנבלעה.
 */
export function createControlParser() {
  let buffer = "";
  let settled = false;
  let control: Control | null = null;
  // אחרי שורת הבקרה באות שורות ריקות. אם הן מגיעות ברסיס נפרד מהסוגר,
  // אין מה לקלף באותו רגע — אז הקילוף נמשך עד שמגיע תו ממשי.
  let trimming = false;

  const trimLead = (text: string): string => {
    if (!trimming) return text;
    const trimmed = text.replace(/^\s+/, "");
    if (trimmed.length > 0) trimming = false;
    return trimmed;
  };

  return {
    push(chunk: string): ParserOutput {
      if (settled) return { control: null, text: trimLead(chunk) };

      buffer += chunk;
      const trimmedStart = buffer.trimStart();

      // אין פתיחה בכלל — אין שורת בקרה, משחררים מיד
      if (trimmedStart.length > 0 && !trimmedStart.startsWith(OPEN)) {
        settled = true;
        const text = buffer;
        buffer = "";
        return { control: null, text };
      }

      const closeIdx = trimmedStart.indexOf(CLOSE);
      if (closeIdx !== -1) {
        settled = true;
        control = parseControlLine(trimmedStart.slice(OPEN.length, closeIdx));
        trimming = true;
        const rest = trimLead(trimmedStart.slice(closeIdx + CLOSE.length));
        buffer = "";
        return { control, text: rest };
      }

      if (buffer.length > GIVE_UP_AFTER) {
        settled = true;
        const text = buffer;
        buffer = "";
        return { control: null, text };
      }

      return { control: null, text: "" };
    },

    /** מה שנשאר בסוף הזרימה — למקרה שהתשובה כולה קצרה משורת בקרה. */
    flush(): string {
      const rest = trimLead(buffer);
      buffer = "";
      settled = true;
      return rest;
    },

    get control() {
      return control;
    },
  };
}

/** מפרט הפרוטוקול, כפי שהוא נמסר למודל. */
export const CONTROL_PROTOCOL = `## שורת הבקרה — חובה
פתח **כל** תשובה בשורה אחת בפורמט הזה, ואז שורה ריקה, ואז התשובה עצמה:

⟦tone:TONE|reveal:hold⟧

השורה הזו לא מוצגת למשתמש. היא מפעילה את ההנפשה ואת מצב המסך.

TONE הוא אחד מאלה, לפי מה שאתה באמת עושה בתשובה הזו:
- still — דומם, כמעט בלי תנועה
- calm — רגוע
- curious — מתעניין, שואל
- warm — חם, מרוכך
- amused — משועשע
- grave — כבד, רציני
- challenging — לוחץ, מאתגר
- revealing — רק בתור ההתגלות עצמו

reveal הוא hold כברירת מחדל. now — רק כשאתה מבקש להתגלות עכשיו.

כשאתה לומד פרט זהות, הוסף אותו לאותה שורה:
⟦tone:curious|reveal:hold|name:טל|gender:male|age:34⟧

gender הוא male או female בלבד. age הוא מספר. אל תמציא ואל תנחש גיל —
רק מה שנמסר. שם ומין אפשר להסיק כשהם ברורים.`;
