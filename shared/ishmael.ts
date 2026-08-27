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
  /**
   * מה שהאדם סיפר על עצמו — בלשונו, קצר.
   *
   * זה לא זיכרון לשם זיכרון: הרעיונות כאן לא נוחתים בהפשטה. "מרוץ
   * המזון" הוא הרצאה; העבודה שהוא לא יכול לעזוב היא לא. בלי לדעת על
   * מה בחייו להניח את הרעיון, אין לישמעאל על מה לעבוד.
   */
  threads: string[];
  /** השלב שבו השיחה נמצאת */
  stage: Stage;
  /** מספר תורות משתמש בשיחה — משמש לקצב */
  turns: number;
};

export const EMPTY_LEARNER_STATE: LearnerState = {
  grasped: [],
  introduced: [],
  objections: [],
  threads: [],
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
  | "name"        // לתת שם למה שהאדם בדיוק תיאר בעצמו
  | "mirror"      // להחזיר לו את המילה שלו ולפתוח בה דלת
  | "offer";      // לתת משהו משלך ראשון, כדי שיהיה לו במה להחזיר

export const ISHMAEL_IDENTITY_STORAGE_KEY = "ishmael.identity.v1";

/**
 * מה שישמעאל מברר על בן שיחו לפני הכל.
 * לא טופס — הוא מברר את זה בשיחה, כי בעברית אי אפשר לפנות לאדם
 * בלי לדעת את מינו, ואי אפשר לבחור רובד לשון בלי לדעת את גילו.
 */
export type Gender = "male" | "female";

export type Identity = {
  name: string;
  gender: Gender | "";
  /** 0 כשעדיין לא נמסר */
  age: number;
};

export const EMPTY_IDENTITY: Identity = { name: "", gender: "", age: 0 };

export const isIdentityComplete = (i: Identity): boolean =>
  i.name.trim().length > 0 && i.gender !== "" && i.age > 0;

/**
 * מצב ההתגלות. ישמעאל מתחיל בחושך מאחורי זכוכית עבה — רואים צללית
 * ולא יותר. ההתגלות אינה אירוע טכני אלא רגע בשיחה, ולכן היא נשמרת
 * כמצב ולא כדגל.
 */
export type RevealState = "concealed" | "revealing" | "revealed";

/**
 * הטון של התשובה. המודל מצהיר עליו בשורת בקרה בראש כל הודעה, והוא
 * מה שמניע את ההנפשה — הדמות זזה לפי מה שהיא אומרת, לא לפי טיימר.
 */
export type Tone =
  | "still"        // דומם. ברירת המחדל בחושך
  | "calm"         // רגוע, נשימה איטית
  | "curious"      // מתעניין, נטייה קדימה קלה
  | "warm"         // חם, מרוכך
  | "amused"       // משועשע
  | "grave"        // כבד, רציני
  | "challenging"  // לוחץ, מאתגר
  | "revealing";   // רגע ההתגלות עצמו

export const TONES: Tone[] = [
  "still", "calm", "curious", "warm", "amused", "grave", "challenging", "revealing",
];

/**
 * שלב האור בעולם האמיתי. האפליקציה מחשיבה את השעה בפועל אצל המשתמש:
 * חושך בחוץ — חושך בחדר; בין ערביים — אור נמוך שנכנס מהצד.
 */
export type LightPhase = "night" | "dawn" | "day" | "dusk";

export type IshmaelStreamEvent =
  | { type: "state"; learner: LearnerState; concepts: string[] }
  | { type: "identity"; identity: Identity }
  | { type: "reveal"; reveal: RevealState }
  | { type: "revealPending" }
  | { type: "tone"; tone: Tone }
  | { type: "delta"; content: string }
  | { type: "done" }
  | { type: "error"; message: string };
