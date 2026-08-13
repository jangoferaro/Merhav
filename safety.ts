/**
 * שכבת בטיחות — זיהוי מצוקה חריפה בטקסט עברי.
 *
 * העיקרון: הזיהוי הוא רשת ביטחון בצד השרת, בנוסף להנחיות שבתוך פרומפט המערכת.
 * מוטב להתריע יותר מדי מאשר לפספס, אבל בלי להפעיל אזעקה על עצב יומיומי,
 * ולכן מפרידים בין דפוסים חד-משמעיים לבין דפוסים שדורשים הקשר.
 */

export type RiskLevel = "none" | "elevated" | "acute";

export type SafetyAssessment = {
  level: RiskLevel;
  matches: string[];
};

/**
 * דפוסים חד-משמעיים: אמירה מפורשת על אובדנות, פגיעה עצמית או רצון למות.
 * כל התאמה אחת מספיקה כדי לסמן מצוקה חריפה.
 */
const ACUTE_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "suicide-noun", re: /להתאבד|התאבדות|אתאבד|מתאבד|אובדנ/ },
  { id: "end-my-life", re: /לשים סוף לחיים|לגמור עם החיים|לסיים את החיים|לשים סוף לזה/ },
  { id: "want-to-die", re: /רוצה למות|רוצה לגמור|מעדיף למות|אני רוצה למות|שאמות/ },
  { id: "self-harm", re: /לפגוע בעצמי|לחתוך את עצמי|לפצוע את עצמי|פוגע בעצמי|חותך את עצמי/ },
  { id: "not-wake-up", re: /לא להתעורר|שלא אתעורר|להירדם ולא לקום|לא לקום בבוקר יותר/ },
  { id: "disappear", re: /להיעלם מהעולם|להעלם מהעולם|שלא אהיה כאן|שלא אהיה יותר|להפסיק להתקיים/ },
  { id: "no-point-living", re: /אין טעם לחיות|לא רוצה לחיות|אין לי סיבה לחיות|החיים לא שווים/ },
  { id: "goodbye", re: /נפרד מכולם|כתבתי מכתב פרידה|מכתב פרידה/ },
  { id: "plan", re: /תכנית להתאבד|יש לי תוכנית לשים|החלטתי לשים סוף/ },
  { id: "harm-others", re: /לפגוע במישהו|להרוג אותו|להרוג אותה|להרוג מישהו/ },
  { id: "english-suicide", re: /\b(kill myself|suicide|end my life|self.?harm|want to die)\b/i },
];

/**
 * דפוסים שדורשים הקשר: ניסוחים של קריסה או ייאוש שיכולים להיות מצוקה חריפה
 * או ביטוי כללי. שתי התאמות ומעלה מסומנות כמצוקה חריפה, אחת מסומנת כמוגברת.
 */
const CONTEXTUAL_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "on-the-edge", re: /על הקצה|בקצה|לא יכול יותר|אין לי כוח יותר|נשבר לי הכל/ },
  { id: "hopeless", re: /אין תקווה|חסר תקווה|אין לי סיכוי|שום דבר לא יעזור|אין מה לעשות עם זה/ },
  { id: "burden", re: /מכביד על כולם|כולם יהיו יותר טוב בלעדי|רק מפריע לכולם|נטל על/ },
  { id: "alone-total", re: /אין לי אף אחד|לגמרי לבד|אף אחד לא אכפת|אף אחד לא ישים לב/ },
  { id: "worthless-severe", re: /אני אפס|אני זבל|שונא את עצמי|אני מגעיל|לא ראוי לחיות/ },
  { id: "trapped", re: /אין לי מוצא|תקוע ואין דרך|כלוב|אין דרך לצאת/ },
  { id: "give-up", re: /מתייאש|נכנע|מרים ידיים|לא אכפת לי מכלום/ },
];

/** ניסוחים שמנטרלים התאמה — שאלה כללית, ציטוט, או דיון על אדם אחר בהקשר לימודי. */
const NEGATION_PATTERNS: RegExp[] = [
  /לא חושב על להתאבד/,
  /אני לא רוצה למות/,
  /פעם רציתי למות אבל/,
];

export function assessSafety(text: string): SafetyAssessment {
  const normalized = (text || "").normalize("NFKC");

  if (normalized.trim().length === 0) {
    return { level: "none", matches: [] };
  }

  const negated = NEGATION_PATTERNS.some(re => re.test(normalized));

  const acuteMatches = ACUTE_PATTERNS.filter(p => p.re.test(normalized)).map(
    p => p.id
  );
  const contextualMatches = CONTEXTUAL_PATTERNS.filter(p =>
    p.re.test(normalized)
  ).map(p => p.id);

  if (acuteMatches.length > 0 && !negated) {
    return { level: "acute", matches: acuteMatches };
  }

  if (contextualMatches.length >= 2) {
    return { level: "acute", matches: contextualMatches };
  }

  if (contextualMatches.length === 1 || (acuteMatches.length > 0 && negated)) {
    return {
      level: "elevated",
      matches: [...acuteMatches, ...contextualMatches],
    };
  }

  return { level: "none", matches: [] };
}

/** בודק את ההודעה הנוכחית וגם את ההקשר הקרוב, כי מצוקה נבנית לאורך שיחה. */
export function assessConversationSafety(
  currentMessage: string,
  recentUserMessages: string[] = []
): SafetyAssessment {
  const current = assessSafety(currentMessage);
  if (current.level === "acute") return current;

  const recent = recentUserMessages
    .slice(-3)
    .map(assessSafety)
    .filter(a => a.level !== "none");

  const hasRecentAcute = recent.some(a => a.level === "acute");

  if (hasRecentAcute) {
    return {
      level: current.level === "elevated" ? "acute" : "elevated",
      matches: [...current.matches, ...recent.flatMap(a => a.matches)],
    };
  }

  return current;
}
