/**
 * הגדרות סביבה לשרת. השרת מדבר עם ה-API של Anthropic (Claude) ישירות —
 * לא עם הפרוקסי הפנימי של Manus ולא עם OpenAI.
 */
/**
 * הערכים נקראים בזמן הגישה ולא בזמן טעינת המודול. ההבדל חשוב בשני
 * מקומות: בבדיקות אפשר להחליף משתנה סביבה בלי לטעון מחדש את כל שרשרת
 * המודולים, ובזמן ריצה זה מונע מצב שבו סדר הייבוא קובע אם המפתח נקרא
 * לפני ש-dotenv הספיק לטעון את הקובץ.
 */
export const ENV = {
  /** מפתח ה-API שלכם מ-console.anthropic.com */
  get apiKey(): string {
    return process.env.ANTHROPIC_API_KEY || "";
  },
  /**
   * כתובת בסיס אופציונלית, למקרה שאתם משתמשים בפרוקסי תואם-Anthropic
   * משלכם (למשל Bedrock/Vertex gateway). ברירת המחדל היא ה-API הרשמי.
   */
  get apiBaseUrl(): string {
    return process.env.ANTHROPIC_API_BASE_URL || "https://api.anthropic.com";
  },
};
