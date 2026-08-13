import {
  EMPTY_PROFILE,
  GENDER_OPTIONS,
  MAX_NAME_LENGTH,
  isValidAge,
  isValidName,
  type Gender,
  type Profile,
} from "../shared/merhav";

const GENDER_VALUES = GENDER_OPTIONS.map(option => option.value);

/** מנקה פרופיל שהגיע מהלקוח. */
export function normalizeProfile(raw: unknown): Profile {
  if (!raw || typeof raw !== "object") return { ...EMPTY_PROFILE };

  const source = raw as Record<string, unknown>;

  const name =
    typeof source.name === "string"
      ? source.name.trim().slice(0, MAX_NAME_LENGTH)
      : "";

  const ageValue =
    typeof source.age === "number"
      ? Math.floor(source.age)
      : typeof source.age === "string"
        ? Number.parseInt(source.age, 10)
        : 0;

  const gender =
    typeof source.gender === "string" &&
    GENDER_VALUES.includes(source.gender as Gender)
      ? (source.gender as Gender)
      : "";

  return {
    name: isValidName(name) ? name : "",
    age: isValidAge(ageValue) ? ageValue : 0,
    gender,
    completed: source.completed === true,
  };
}

function ageGuidance(age: number): string {
  if (age === 0) return "";
  if (age < 18) {
    return "הוא צעיר. דבר בשפה יומיומית ופשוטה במיוחד, בלי מילים גבוהות, והתייחס להקשרים של גיל צעיר כמו בית ספר, הורים וחברים כשזה עולה.";
  }
  if (age < 30) {
    return "דבר בשפה יומיומית ונינוחה, ללא רשמיות.";
  }
  if (age >= 60) {
    return "דבר בכבוד ובנחת, בשפה בהירה ולא סלנגית.";
  }
  return "דבר בשפה יומיומית ובוגרת.";
}

function genderGuidance(gender: Profile["gender"]): string {
  if (gender === "female") {
    return "פנה אליה בלשון נקבה בעברית, בעקביות ובכל התשובות.";
  }
  if (gender === "male") {
    return "פנה אליו בלשון זכר בעברית, בעקביות ובכל התשובות.";
  }
  if (gender === "other") {
    return "השתמש בניסוחים ניטרליים מגדרית כשאפשר, ואל תניח מגדר.";
  }
  return "לא ידוע המגדר. השתמש בניסוחים שמתאימים לכל מגדר כשאפשר, ואל תשאל על זה.";
}

/**
 * הופך את הפרופיל להודעת מערכת. מחזיר null כשאין שום פרט,
 * כדי לא להוסיף רעש מיותר לפרומפט.
 */
export function buildProfileContext(profile: Profile): string | null {
  const facts: string[] = [];

  if (profile.name) {
    facts.push(
      `השם שלו/שלה: ${profile.name}. בתשובה הראשונה שלך בשיחה פנה אליו/אליה בשם, פעם אחת ובטבעיות. אחרי זה השתמש בשם רק מדי פעם, לא בכל הודעה.`
    );
  }
  if (profile.age > 0) {
    facts.push(`הגיל: ${profile.age}. ${ageGuidance(profile.age)}`);
  }

  facts.push(genderGuidance(profile.gender));

  if (!profile.name && profile.age === 0 && profile.gender === "") {
    return null;
  }

  return `פרטים בסיסיים על מי שמדבר איתך (לשימוש שלך, אל תציג אותם כרשימה ואל תאשר אותם בקול):

${facts.join("\n")}`;
}
