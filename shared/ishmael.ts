/**
 * טיפוסים וקבועים משותפים למנוע "ישמעאל" — מנוע ידע שיחתי
 * המחזיק את מערכת הרעיונות של דניאל קווין.
 *
 * הבהרה חשובה: בסיס הידע כאן הוא ניסוח עצמאי של *הרעיונות* —
 * מושגים, טיעונים, מהלכים דיאלקטיים — ולא טקסט מצוטט מהספרים.
 * הספרים עצמם מוגנים בזכויות יוצרים ואינם נמצאים ברפוזיטורי הזה.
 * מי שרוצה לעגן את המנוע בטקסט מלא — ראו server/ishmael/ingest.ts.
 */

export const ISHMAEL_MAX_MESSAGE_LENGTH = 4000;
export const ISHMAEL_MAX_HISTORY_MESSAGES = 30;

export const ISHMAEL_CONVERSATION_STORAGE_KEY = "ishmael.conversation.v1";
export const ISHMAEL_LEARNER_STORAGE_KEY = "ishmael.learner.v1";

/** מזהי היצירות בקורפוס. */
export type WorkId =
  | "ishmael"
  | "my-ishmael"
  | "story-of-b"
  | "providence"
  | "beyond-civilization"
  | "tales-of-adam"
  | "the-holy"
  | "after-dachau"
  | "lined-paper"
  | "man-who-grew-young";

/**
 * שלבי הקוריקולום — סדר הלימוד שהמנוע מוביל אליו.
 * הסדר אינו סדר ההוצאה לאור אלא סדר ההוראה: מה צריך להבין קודם
 * כדי שהדבר הבא יהיה מובן בכלל.
 */
export type Stage =
  | "captivity"    // יש כלוב, ואתה בתוכו
  | "story"        // תרבות = אנשים שמגלמים סיפור
  | "taker-story"  // הסיפור שהתרבות שלנו מגלמת
  | "law"          // יש חוק, והוא נאכף
  | "leaver-story" // סיפור אחר, שנבדק שלושה מיליון שנה
  | "diversity"    // אין דרך אחת נכונה לחיות
  | "remembering"  // השִׁכחה הגדולה וההיזכרות
  | "beyond";      // מה עושים בבוקר שאחרי

export const STAGE_ORDER: Stage[] = [
  "captivity",
  "story",
  "taker-story",
  "law",
  "leaver-story",
  "diversity",
  "remembering",
  "beyond",
];

/** מה המנוע חושב שהאדם ממול כבר תפס. נשמר במכשיר בלבד. */
export type LearnerState = {
  /** מזהי מושגים שהאדם הראה שהוא מחזיק בהם */
  grasped: string[];
  /** מזהי מושגים שהוצגו אך עדיין לא הופנמו */
  introduced: string[];
  /** התנגדויות שהאדם העלה, בלשונו */
  objections: string[];
  /** השלב שבו השיחה נמצאת */
  stage: Stage;
  /** מספר תורות משתמש בשיחה — משמש לקצב */
  turns: number;
};

export const EMPTY_LEARNER_STATE: LearnerState = {
  grasped: [],
  introduced: [],
  objections: [],
  stage: "captivity",
  turns: 0,
};

/** מהלך דיאלקטי שהמנוע יכול לבחור בו בתור הבא. */
export type Move =
  | "question"    // להחזיר שאלה במקום תשובה
  | "analogy"     // משל / מקרה מקביל
  | "evidence"    // עובדה מהעולם, לא מהספר
  | "reframe"     // לחשוף את ההנחה שמתחת לשאלה
  | "concede"     // להודות בנקודה טובה של האדם
  | "push"        // ללחוץ על סתירה
  | "name";       // לתת שם למה שהאדם בדיוק תיאר בעצמו

export type IshmaelStreamEvent =
  | { type: "state"; stage: Stage; concepts: string[] }
  | { type: "delta"; content: string }
  | { type: "done" }
  | { type: "error"; message: string };
