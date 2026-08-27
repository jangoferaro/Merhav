import { EMPTY_IDENTITY, isIdentityComplete, type Gender, type Identity } from "../../shared/ishmael";

/**
 * זהות בן השיח.
 *
 * למה זה הדבר הראשון: בעברית אי אפשר לפתוח משפט אל אדם בלי לדעת את
 * מינו — "אתה חושב" ו"את חושבת" הן שתי מילים שונות בכל פועל, בכל תואר
 * ובכל פנייה. מנוע שמדבר עברית ולא יודע את זה או שיישמע שגוי, או
 * שייאלץ לכתוב בלשון מגושמת שמתחמקת מהפנייה. הגיל נחוץ לרובד הלשון.
 *
 * ישמעאל מברר את זה בשיחה ולא בטופס — זה גם טבעי יותר, וגם משרת את
 * המתח: הוא שואל שאלות ואינו עונה על אף אחת מהשאלות שנשאלות בחזרה.
 */

export function normalizeIdentity(raw: unknown): Identity {
  if (!raw || typeof raw !== "object") return { ...EMPTY_IDENTITY };
  const r = raw as Record<string, unknown>;

  const name = typeof r.name === "string" ? r.name.trim().slice(0, 40) : "";
  const gender: Gender | "" =
    r.gender === "male" || r.gender === "female" ? r.gender : "";
  const ageRaw = typeof r.age === "number" ? Math.floor(r.age) : 0;
  const age = ageRaw >= 5 && ageRaw <= 120 ? ageRaw : 0;

  return { name, gender, age };
}

/** מיזוג עדכון שהגיע מהמודל אל הזהות הקיימת — בלי למחוק מה שכבר ידוע. */
export function mergeIdentity(current: Identity, update: Partial<Identity>): Identity {
  const next = normalizeIdentity({ ...current, ...update });
  return {
    name: next.name || current.name,
    gender: next.gender || current.gender,
    age: next.age || current.age,
  };
}

/** מה חסר, לפי הסדר שבו כדאי לברר. */
export function missingField(identity: Identity): "name" | "gender" | "age" | null {
  if (!identity.name.trim()) return "name";
  if (!identity.gender) return "gender";
  if (!identity.age) return "age";
  return null;
}

const GENDER_RULES: Record<Gender, string> = {
  male:
    "בן שיחך זכר. פנה אליו בלשון זכר בכל פועל, תואר וכינוי: אתה, שלך, " +
    "חושב, רואה, אמרת. אל תחליק ללשון נקבה אפילו במשפט אחד.",
  female:
    "בת שיחך נקבה. פני אליה בלשון נקבה בכל פועל, תואר וכינוי: את, שלך, " +
    "חושבת, רואה, אמרת. אל תחליק ללשון זכר אפילו במשפט אחד. שים לב " +
    "במיוחד לצורות ציווי ולשאלות — שם הטעות הכי נפוצה.",
};

/** רובד הלשון לפי גיל. לא תוכן אחר — ניסוח אחר. */
function ageRegister(age: number): string {
  if (age <= 15) {
    return (
      "בן שיחך צעיר מאוד. משפטים קצרים, מילים יומיומיות, בלי מונחים " +
      "מופשטים לפני שיש להם משל. אל תרד לגובה של ילד ואל תתיילד — " +
      "דבר אליו כאל מישהו שמסוגל, רק בלי אוצר מילים אקדמי."
    );
  }
  if (age <= 25) {
    return (
      "בן שיחך צעיר. אפשר ישיר וחד, בלי חגיגיות. דוגמאות מהעולם שהוא " +
      "חי בו — לימודים, עבודה ראשונה, רשתות — עובדות טוב יותר מדוגמאות " +
      "היסטוריות."
    );
  }
  if (age <= 60) {
    return "בן שיחך בוגר. אפשר במלוא המורכבות, בלי לפשט ובלי להסביר יתר על המידה.";
  }
  return (
    "בן שיחך מבוגר וראה הרבה. אל תסביר לו איך העולם עבד פעם — הוא " +
    "היה שם. הישען על זה: שאל אותו מה השתנה בימי חייו."
  );
}

/** שכבת ההקשר של הזהות. */
export function buildIdentityContext(identity: Identity): string {
  if (!isIdentityComplete(identity)) {
    const missing = missingField(identity);
    const known: string[] = [];
    if (identity.name) known.push(`שמו: ${identity.name}`);
    if (identity.gender) known.push(`מינו: ${identity.gender === "male" ? "זכר" : "נקבה"}`);
    if (identity.age) known.push(`גילו: ${identity.age}`);

    const ask: Record<string, string> = {
      name: "עדיין אינך יודע את שמו. זה הדבר הראשון שאתה צריך.",
      gender:
        "אתה יודע את שמו אך לא את מינו. אם השם חד-משמעי בעברית — הסק " +
        "בעצמך ורשום זאת בשורת הבקרה, אל תשאל לחינם. רק אם השם דו-משמעי " +
        "(יובל, שיר, עדן, נועם, אור) שאל — ובקצרה, כאילו זה פרט טכני שנחוץ לך.",
      age: "אתה יודע את שמו ומינו. חסר הגיל.",
    };

    return (
      `## מי מולך\n` +
      (known.length > 0 ? `${known.join(". ")}.\n` : `עדיין אינך יודע עליו דבר.\n`) +
      `${missing ? ask[missing] : ""}\n` +
      `בירור הזהות אינו טופס. שאל שאלה אחת בכל תור, בתוך זרימת השיחה, ` +
      `ואל תבקש שלושה פרטים בבת אחת. אם הוא שואל אותך שאלה בחזרה — אל ` +
      `תענה עליה עדיין. אמור שתענה, ותחזור לשאלה שלך. הסירוב הזה הוא ` +
      `חלק מהמתח, לא גסות רוח.\n` +
      `כשאתה לומד פרט — רשום אותו בשורת הבקרה. אל תחזור עליו בקול ` +
      `("אז אתה בן שלושים ושתיים") אלא אם זה משרת משהו.`
    );
  }

  return (
    `## מי מולך\n` +
    `${identity.name}, בן ${identity.age}.\n` +
    `${GENDER_RULES[identity.gender as Gender]}\n` +
    `${ageRegister(identity.age)}\n` +
    `השתמש בשמו — לא בכל משפט, אבל ברגעים שבהם זה נוחת: כשאתה שואל ` +
    `שאלה קשה, וכשאתה מודה שהוא צדק.`
  );
}
