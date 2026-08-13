/**
 * הגדרות סביבה לשרת. השרת מדבר עם ה-API של Anthropic (Claude) ישירות —
 * לא עם הפרוקסי הפנימי של Manus ולא עם OpenAI.
 */
export const ENV = {
  /** מפתח ה-API שלכם מ-console.anthropic.com */
  apiKey: process.env.ANTHROPIC_API_KEY || "",
  /**
   * כתובת בסיס אופציונלית, למקרה שאתם משתמשים בפרוקסי תואם-Anthropic
   * משלכם (למשל Bedrock/Vertex gateway). ברירת המחדל היא ה-API הרשמי.
   */
  apiBaseUrl: process.env.ANTHROPIC_API_BASE_URL || "https://api.anthropic.com",
};
