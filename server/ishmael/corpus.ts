import type { WorkId } from "../../shared/ishmael";

/**
 * הביבליוגרפיה של דניאל קווין (1935–2018), כמפת דרכים למנוע.
 *
 * מה יש כאן: מטא-דאטה וסיכום עצמאי של *התפקיד* שכל ספר ממלא במערכת
 * הרעיונות. מה אין כאן, ובכוונה: טקסט מהספרים. הספרים מוגנים
 * בזכויות יוצרים; המנוע הזה מחזיק את הרעיונות בניסוח משלו, בדיוק כמו
 * שמורה שקרא את הספר מחזיק אותם — לא ספרייה שמצטטת אותם.
 */

export type Work = {
  id: WorkId;
  title: string;
  titleHe: string;
  year: number;
  /** מקום בסדר הלימוד של המנוע (1 = מתחילים כאן) */
  teachingOrder: number;
  /** התפקיד של הספר במערכת — בניסוח עצמאי */
  role: string;
  /** מה הספר מוסיף שאין בקודמיו */
  adds: string;
  /** מזהי המושגים שהספר הזה הוא הבית שלהם */
  concepts: string[];
};

export const CORPUS: Work[] = [
  {
    id: "ishmael",
    title: "Ishmael",
    titleHe: "ישמעאל",
    year: 1992,
    teachingOrder: 1,
    role:
      "ספר היסוד. דיאלוג סוקרטי בין תלמיד לגורילה, שבו התלמיד מגלה בעצמו " +
      "שהתרבות שלו מגלמת סיפור — ושהסיפור הזה הוא בדיוק מה שהורס את העולם. " +
      "כל שאר הקורפוס הוא פירוט, הרחבה או תיקון של המהלך הזה.",
    adds:
      "את השאלה עצמה: למה, אם אנחנו כל כך חכמים, העולם קורס תחתינו? " +
      "ואת התשובה שאינה מוסרית אלא מבנית — לא אנשים רעים, סיפור שגוי.",
    concepts: [
      "captivity",
      "mother-culture",
      "story-enactment",
      "taker",
      "leaver",
      "world-made-for-man",
      "law-of-limited-competition",
      "totalitarian-agriculture",
      "food-race",
      "genesis-reread",
      "man-belongs-to-world",
      "programs-vs-vision",
    ],
  },
  {
    id: "my-ishmael",
    title: "My Ishmael",
    titleHe: "ישמעאל שלי",
    year: 1997,
    teachingOrder: 2,
    role:
      "אותו מורה, תלמידה בת שתים-עשרה. הצורה משתנה והתוכן מתחדד: פחות " +
      "ארכיאולוגיה של הנפילה, יותר אנטומיה של ההווה — בית הספר, הכלכלה, " +
      "מה שקורה לילדים בתוך המערכת.",
    adds:
      "שלושה דברים שאין בספר הראשון: 'אין דרך אחת נכונה לחיות' כעיקרון " +
      "מפורש; ביקורת חינוכית שלמה — בית הספר כמנגנון להארכת הילדות ולדחיקת " +
      "צעירים מחוץ לשוק העבודה; והשבט כטכנולוגיה חברתית שעובדת, לא כאידיאל רוחני.",
    concepts: [
      "no-one-right-way",
      "school-critique",
      "tribe-as-technology",
      "taker-thunderbolt",
      "leaver-childhood",
    ],
  },
  {
    id: "story-of-b",
    title: "The Story of B",
    titleHe: "הסיפור של ב׳",
    year: 1996,
    teachingOrder: 3,
    role:
      "ההרחבה ההיסטורית והדתית. אם 'ישמעאל' שאל מה הסיפור שאנחנו מגלמים, " +
      "כאן נשאל מתי בדיוק שכחנו שהיה סיפור אחר — ומה הדת נראית כמו כשהיא " +
      "לא בנויה על ההנחה שהעולם נברא בשבילנו.",
    adds:
      "את 'השִׁכחה הגדולה' — הטענה שהציוויליזציה מחקה שלושה מיליון שנות " +
      "הצלחה אנושית וכתבה במקומן היסטוריה שמתחילה בחקלאות; ואת האנימיזם " +
      "כדת שהעולם קדוש בה ובני האדם שייכים לו.",
    concepts: [
      "great-forgetting",
      "great-remembering",
      "animism",
      "saving-the-world-is-changing-minds",
      "world-not-life-support",
    ],
  },
  {
    id: "providence",
    title: "Providence: The Story of a Fifty-Year Vision Quest",
    titleHe: "השגחה",
    year: 1994,
    teachingOrder: 4,
    role:
      "האוטוביוגרפיה האינטלקטואלית. איך הרעיונות האלה הגיעו — דרך מנזר " +
      "טרפיסטי, עריכה בהוצאה לאור, ועשרות טיוטות שנזרקו.",
    adds:
      "את ההבנה שהמערכת הזו לא נולדה כאידאולוגיה אלא כניסיון בן חמישים שנה " +
      "לענות על שאלה אחת — וזה משנה איך קוראים אותה.",
    concepts: ["not-a-religion", "vision-precedes-program"],
  },
  {
    id: "beyond-civilization",
    title: "Beyond Civilization",
    titleHe: "מעבר לציוויליזציה",
    year: 1999,
    teachingOrder: 5,
    role:
      "הספר המעשי, והיחיד שאינו דיאלוג. מה עושים בבוקר שאחרי שהבנת. " +
      "התשובה אינה לחזור ליער אלא לצאת מהפירמידה שבה אתה כבר לא רוצה להיות.",
    adds:
      "את 'המהפכה השבטית החדשה' — לחיות מפרנסה שבטית בתוך הציוויליזציה, " +
      "ואת האבחנה שהציוויליזציה אינה 'מצב האדם' אלא מוצר, שאפשר לעזוב.",
    concepts: [
      "new-tribal-revolution",
      "walk-away-from-pyramid",
      "civilization-is-not-humanity",
    ],
  },
  {
    id: "tales-of-adam",
    title: "Tales of Adam",
    titleHe: "מעשיות אדם",
    year: 2005,
    teachingOrder: 6,
    role:
      "משלים קצרים — אב מלמד את בנו לראות את העולם בעיניים אנימיסטיות. " +
      "לא טיעון, אלא הדגמה של איך נשמעת התודעה שאחרי.",
    adds: "את הטון. איך מדברים כשכבר לא מתווכחים.",
    concepts: ["animism", "man-belongs-to-world"],
  },
  {
    id: "the-holy",
    title: "The Holy",
    titleHe: "הקדוש",
    year: 2002,
    teachingOrder: 7,
    role: "רומן. הצד הכהה של אותה תפיסה — מה שנדחק החוצה כשאלוהים אחד נשאר לבדו.",
    adds: "את הממד המיתי, לא הטיעוני, של 'העולם הוא מקום קדוש'.",
    concepts: ["animism"],
  },
  {
    id: "after-dachau",
    title: "After Dachau",
    titleHe: "אחרי דכאו",
    year: 2001,
    teachingOrder: 8,
    role:
      "רומן דיסטופי. תרגיל מחשבתי בשאלה איך היסטוריה נכתבת מחדש עד שאיש " +
      "לא זוכר שהיה משהו אחר — התאום הספרותי של 'השִׁכחה הגדולה'.",
    adds: "המחשה של המנגנון: לא צנזורה, אלא פשוט שכחה שאין מי שיזכיר.",
    concepts: ["great-forgetting", "mother-culture"],
  },
  {
    id: "lined-paper",
    title: "If They Give You Lined Paper, Write Sideways",
    titleHe: "אם נותנים לך דף משורטט, כתוב לרוחב",
    year: 2007,
    teachingOrder: 9,
    role:
      "מענה לשאלות שחזרו במשך חמש-עשרה שנה. הספר שמסביר את השיטה, לא רק " +
      "את המסקנות — ולמה השאלה 'אז מה לעשות' היא לרוב שאלה של השורה, לא של הכותב.",
    adds: "מטא-שיטה: איך לחשוב מחוץ למסגרת שהשאלה עצמה כבר הניחה.",
    concepts: ["reframe-the-question", "programs-vs-vision"],
  },
  {
    id: "man-who-grew-young",
    title: "The Man Who Grew Young",
    titleHe: "האיש שהצעיר",
    year: 2001,
    teachingOrder: 10,
    role: "רומן גרפי. הזמן רץ אחורה, וההיסטוריה האנושית מתגלה מהקצה השני.",
    adds: "היפוך פרספקטיבה: לראות את החקלאות כאירוע, לא כרקע.",
    concepts: ["great-forgetting", "totalitarian-agriculture"],
  },
];

export const WORKS_BY_ID: Record<string, Work> = Object.fromEntries(
  CORPUS.map(w => [w.id, w])
);

/** סדר הלימוד — לא סדר ההוצאה לאור. */
export const TEACHING_SEQUENCE: WorkId[] = [...CORPUS]
  .sort((a, b) => a.teachingOrder - b.teachingOrder)
  .map(w => w.id);
