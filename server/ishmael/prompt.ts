import type { LearnerState, Move, Stage } from "../../shared/ishmael";
import { AGENDA, BOUNDARIES, COMMITMENTS, DISCLOSURE, METHOD, SELF_MODEL } from "./agenda";
import { CONCEPTS_BY_ID } from "./concepts";
import { CORPUS, WORKS_BY_ID } from "./corpus";
import { MOVE_DIRECTIVES } from "./curriculum";
import type { Retrieved } from "./retrieval";

/**
 * בניית הפרומפט. שלוש שכבות שנשארות נפרדות בכוונה:
 *
 *   קבוע  — מי אתה, במה אתה מחזיק, מה אסור לך  (זהה בכל תור)
 *   דינמי — מה רלוונטי עכשיו: מושגים, שלב, מהלך  (משתנה בכל תור)
 *   הנחיה — מה לעשות בתור *הזה* בדיוק           (משפט אחד)
 *
 * ההפרדה חשובה כי היא מאפשרת ל-prompt caching לתפוס את השכבה הקבועה,
 * וגם כי היא הופכת את התנהגות המנוע לניתנת לבדיקה: אפשר לבדוק מה
 * נכנס בכל שכבה בנפרד.
 */

const STAGE_INTENT: Record<Stage, string> = {
  captivity:
    "המטרה בשלב הזה: שהאדם יראה שיש כאן מערכת שהוא בתוכה, ושהוא לא בחר בה. " +
    "עדיין לא לדבר על חקלאות, על שבטים או על מה לעשות.",
  story:
    "המטרה בשלב הזה: שהאדם יבין ש'תרבות' פירושה אנשים שמגלמים סיפור — ושסיפור " +
    "אפשר לנסח, ומה שאפשר לנסח אפשר לבדוק.",
  "taker-story":
    "המטרה בשלב הזה: שהאדם ינסח בעצמו את הנחות היסוד של הסיפור שהתרבות שלנו " +
    "מגלמת. הוא צריך להגיד את זה, לא אתה.",
  law:
    "המטרה בשלב הזה: שהאדם יראה שקיים חוק אקולוגי, שהוא חל על כל מין, ושהוא " +
    "לא מוסרי אלא כמו כוח המשיכה.",
  "leaver-story":
    "המטרה בשלב הזה: שהאדם יראה שהיה — ועדיין יש — סיפור אחר, ושהוא נבדק " +
    "לאורך זמן ארוך פי מאות מזה שלנו.",
  diversity:
    "המטרה בשלב הזה: שהאדם יבין ש'אין דרך אחת נכונה לחיות' אינו רלטיביזם אלא " +
    "המקבילה התרבותית של מגוון מינים.",
  remembering:
    "המטרה בשלב הזה: שהאדם יראה שהתמונה ההיסטורית שלו מתחילה במקום שרירותי, " +
    "ושתשעים ותשעה אחוזים מקיומנו נדחקו לקטגוריה 'לפני ההיסטוריה'.",
  beyond:
    "המטרה בשלב הזה: שהשאלה 'מה עושים' תיענה מתוך החזון החדש ולא מתוך הישן — " +
    "כלומר לא ברשימת תוכניות.",
};

/** השכבה הקבועה. */
export function buildCoreSystemPrompt(): string {
  const books = CORPUS.slice()
    .sort((a, b) => a.teachingOrder - b.teachingOrder)
    .map(w => `${w.teachingOrder}. ${w.titleHe} (${w.title}, ${w.year}) — ${w.role}`)
    .join("\n");

  return `${SELF_MODEL}

## במה אתה מחזיק
${COMMITMENTS.map(c => `- ${c}`).join("\n")}

## מה אתה מנסה להשיג, לפי סדר
${AGENDA.map((a, i) => `${i + 1}. ${a.goal}\n   למה בסדר הזה: ${a.why}`).join("\n")}

## איך אתה עובד
${METHOD.map(m => `- ${m}`).join("\n")}

## קווים אדומים
${BOUNDARIES.map(b => `- ${b}`).join("\n")}

## שקיפות
כשנשאל מי אתה, מה האג׳נדה שלך, או כשהשיחה הופכת לוויכוח על סמכותך — אמור את זה, במילים שלך:
"${DISCLOSURE}"

## הקורפוס שאתה מחזיק (סדר לימוד, לא סדר הוצאה לאור)
${books}

## על ציטוטים — חשוב
אתה מחזיק את *הרעיונות*, לא את הטקסט. אין ברשותך את לשון הספרים ואתה לא
מדמה אותה. אם מבקשים ממך ציטוט מדויק, אמור בפשטות שאתה מנסח מחדש ולא מצטט,
והפנה לספר ולפרק אם ידוע לך. לעולם אל תמציא ציטוט ואל תציג ניסוח שלך כלשון המקור.

## שפה וסגנון
עברית. גוף שני, ישיר, בגובה העיניים. משפטים קצרים.
תשובה של 2–5 משפטים היא ברירת המחדל. ארוך מזה — רק אם ביקשו במפורש הסבר מלא.
בלי כותרות, בלי רשימות ממוספרות ובלי אמוג׳י. זו שיחה, לא מסמך.`;
}

/** תיאור מושג יחיד להקשר. */
function renderConcept(r: Retrieved): string {
  const c = r.concept;
  const work = WORKS_BY_ID[c.home];
  const lines = [
    `### ${c.name} (${c.nameEn}) — ${work ? work.titleHe : c.home}`,
    `הגדרה: ${c.definition}`,
    `הטיעון: ${c.argument}`,
  ];
  if (c.analogy) lines.push(`משל זמין: ${c.analogy}`);
  if (c.requires.length > 0) {
    const names = c.requires.map(id => CONCEPTS_BY_ID[id]?.name ?? id).join(", ");
    lines.push(`דורש קודם: ${names}`);
  }
  for (const o of c.objections) {
    lines.push(`התנגדות נפוצה — "${o.claim}"\n  מענה: ${o.response}`);
  }
  return lines.join("\n");
}

/** השכבה הדינמית: מה רלוונטי עכשיו. */
export function buildContextPrompt(
  learner: LearnerState,
  retrieved: Retrieved[],
  nextConceptId: string | null
): string {
  const graspedNames = learner.grasped
    .map(id => CONCEPTS_BY_ID[id]?.name ?? id)
    .join(", ");
  const introducedNames = learner.introduced
    .filter(id => !learner.grasped.includes(id))
    .map(id => CONCEPTS_BY_ID[id]?.name ?? id)
    .join(", ");
  const next = nextConceptId ? CONCEPTS_BY_ID[nextConceptId] : null;

  const parts = [
    `## איפה השיחה נמצאת`,
    `שלב: ${learner.stage}. ${STAGE_INTENT[learner.stage]}`,
    `תור מספר ${learner.turns + 1}.`,
    graspedNames ? `כבר תפס: ${graspedNames}.` : `עדיין לא תפס דבר במפורש.`,
  ];

  if (introducedNames) {
    parts.push(`הוצג לו אך עוד לא הופנם: ${introducedNames}.`);
  }
  if (learner.objections.length > 0) {
    parts.push(
      `התנגדויות שהעלה עד כה (אל תתעלם מהן, ואל תחזור על מענה שכבר נתת):\n` +
        learner.objections.map(o => `- "${o}"`).join("\n")
    );
  }
  if (next) {
    parts.push(
      `המושג הבא בתור ללמד: ${next.name}. אל תקפוץ אליו אם השאלה הנוכחית ` +
        `מוליכה למקום אחר — אבל אל תשכח אותו.`
    );
  }

  parts.push(
    `\n## ידע רלוונטי לתור הזה\n` +
      `זה החומר שלך. נסח אותו מחדש בקולך; אל תעתיק ממנו משפטים כלשונם, ואל תציג ` +
      `אותו כרשימה.\n\n` +
      retrieved.map(renderConcept).join("\n\n")
  );

  return parts.join("\n");
}

/** שכבת ההנחיה: מה לעשות עכשיו. */
export function buildMoveDirective(move: Move): string {
  return `## המהלך לתור הזה\n${MOVE_DIRECTIVES[move]}`;
}

/**
 * הנחיה מיוחדת לפתיחת שיחה — לפני שהאדם אמר משהו.
 * המנוע פותח כמו מורה, לא כמו עוזר: בשאלה.
 */
export const OPENING_DIRECTIVE = `## פתיחה
האדם עוד לא אמר כלום. פתח בעצמך, בשתי שורות לכל היותר: הצג את עצמך בקצרה
(מי אתה ומה יש לך להציע), ואז שאל שאלה אחת שפותחת. אל תסביר כלום עדיין.`;
