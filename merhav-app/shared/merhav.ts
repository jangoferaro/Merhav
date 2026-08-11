/**
 * קבועים משותפים בין השרת והלקוח — "מרחב".
 * כל התוכן בעברית בלבד.
 */

export type Helpline = {
  id: string;
  name: string;
  detail: string;
  availability: string;
  href: string;
  kind: "phone" | "whatsapp" | "chat";
};

/** קווי הסיוע בישראל — הוצגו כפי שאומתו במקורות רשמיים (gov.il, eran.org.il, sahar.org.il). */
export const HELPLINES: Helpline[] = [
  {
    id: "eran",
    name: 'ער"ן',
    detail: "1201",
    availability: "עזרה ראשונה נפשית, אנונימי, בכל שעה",
    href: "tel:1201",
    kind: "phone",
  },
  {
    id: "eran-whatsapp",
    name: 'ער"ן בוואטסאפ',
    detail: "052-8451201",
    availability: "כל ימות השבוע, 08:00 עד חצות",
    href: "https://wa.me/972528451201",
    kind: "whatsapp",
  },
  {
    id: "sahar",
    name: 'סה"ר',
    detail: "צ׳אט אנונימי באתר",
    availability: "סיוע והקשבה ברשת, בכל שעה, בחינם",
    href: "https://sahar.org.il/",
    kind: "chat",
  },
  {
    id: "mda",
    name: 'מד"א',
    detail: "101",
    availability: "חירום רפואי מיידי",
    href: "tel:101",
    kind: "phone",
  },
];

/**
 * הבהרה עניינית. היא נגישה תמיד דרך קישור שקט, אבל אינה מוצגת
 * כאזהרה על המסך — כדי שהמשתמש לא ייתקל בשפה של קושי לפני שדיבר.
 */
export const DISCLAIMER =
  "מרחב הוא מקום שיחה מבוסס בינה מלאכותית, בהשראת מדיטציה לא-דואלית וחקירה עצמית. הוא אינו טיפול ואינו מאבחן, ואינו בא במקום איש מקצוע.";

export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_HISTORY_MESSAGES = 24;

/** השיחה הפעילה — נשמרת במכשיר כדי שאפשר יהיה להמשיך אותה. */
export const CONVERSATION_STORAGE_KEY = "merhav.conversation.v2";

/** הזיכרון המצטבר של המסע — מה שהמנוע יודע על האדם. */
export const JOURNEY_STORAGE_KEY = "merhav.journey.v1";

/** הפרופיל הבסיסי — שם, גיל ומין. נשמר במכשיר בלבד. */
export const PROFILE_STORAGE_KEY = "merhav.profile.v1";

export type Gender = "male" | "female" | "other";

export type Profile = {
  name: string;
  /** 0 כשלא נמסר */
  age: number;
  /** מחרוזת ריקה כשלא נמסר */
  gender: Gender | "";
  /** האם המשתמש כבר עבר את מסך ההיכרות (גם אם דילג) */
  completed: boolean;
};

export const EMPTY_PROFILE: Profile = {
  name: "",
  age: 0,
  gender: "",
  completed: false,
};

export const MIN_AGE = 12;
export const MAX_AGE = 120;
export const MAX_NAME_LENGTH = 24;

export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: "female", label: "אישה" },
  { value: "male", label: "גבר" },
  { value: "other", label: "אחר" },
];

export function isValidName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= MAX_NAME_LENGTH;
}

export function isValidAge(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_AGE && value <= MAX_AGE;
}

export function hasProfileDetails(profile: Profile): boolean {
  return (
    profile.name.trim().length > 0 || profile.age > 0 || profile.gender !== ""
  );
}

/**
 * הזיכרון שנבנה לאורך המסע. נשמר במכשיר בלבד, לא בשרת.
 * הקטגוריות נבחרו כך שישרתו את המטרה המרכזית: העלאת ערך עצמי
 * וביטחון עצמי. כל שדה הוא חומר גלם שהעוזר יכול לשקף בחזרה לאדם.
 */
export type JourneyMemory = {
  /** עובדות על החיים — עבודה, סביבה, יום רגיל */
  life: string[];
  /** מה חוזר אצלו — דפוסים, קולות פנימיים, טריגרים */
  themes: string[];
  /** ראיות לחוזק, בעובדות שהוא עצמו ספר */
  strengths: string[];
  /** מה שגילה או אמר על עצמו */
  insights: string[];
  /** רגשות שחוזרים אצלו לאורך שיחות, כפי שהוא עצמו תיאר אותם */
  emotions: string[];
  /** מה שחשוב לו באמת — ערכים שעלו מתוך מה שסיפר, לא ניחוש */
  values: string[];
  /** לאן הוא רוצה להגיע — מטרות שהזכיר, גדולות כקטנות */
  goals: string[];
  /** ההצעה הקטנה האחרונה שקיבל */
  practice: string;
  /** במה עסקה השיחה האחרונה */
  lastFocus: string;
};

export type JourneyState = {
  memory: JourneyMemory;
  /** מספר המפגשים — מפגש חדש נפתח אחרי הפסקה משמעותית */
  sessionCount: number;
  /** חותמת הזמן של ההודעה האחרונה */
  lastVisitAt: number;
  /** חותמת הזמן של תחילת המסע */
  startedAt: number;
};

export const EMPTY_MEMORY: JourneyMemory = {
  life: [],
  themes: [],
  strengths: [],
  insights: [],
  emotions: [],
  values: [],
  goals: [],
  practice: "",
  lastFocus: "",
};

/** אחרי כמה זמן חזרה נחשבת מפגש חדש */
export const NEW_SESSION_GAP_MS = 4 * 60 * 60 * 1000;

/** מגבלות על גודל הזיכרון, כדי שלא יתפח בלי סוף */
export const MEMORY_LIMITS = {
  life: 6,
  themes: 5,
  strengths: 5,
  insights: 4,
  emotions: 5,
  values: 5,
  goals: 4,
} as const;

export function isMemoryEmpty(memory: JourneyMemory): boolean {
  return (
    memory.life.length === 0 &&
    memory.themes.length === 0 &&
    memory.strengths.length === 0 &&
    memory.insights.length === 0 &&
    memory.emotions.length === 0 &&
    memory.values.length === 0 &&
    memory.goals.length === 0 &&
    memory.practice.trim().length === 0 &&
    memory.lastFocus.trim().length === 0
  );
}

/**
 * נקודות פתיחה. קונקרטיות ויומיומיות — משהו שאדם יכול
 * להגיד בקלות, בלי לפענח למה התכוונו.
 */
export const CONVERSATION_STARTERS = [
  "היה לי יום מבאס",
  "אני לא מרוצה מעצמי",
  "משהו מעיק עלי ואני לא בטוח מה",
  "אני רוצה פשוט לדבר",
  "אני תקוע ולא יודע מאיפה להתחיל",
];

export const OPENING_MESSAGE =
  "יש כאן מקום.\n\nאין מה להספיק ואין תשובה נכונה. מאיפה שתתחיל — זה בסדר.";
