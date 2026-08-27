import {
  EMPTY_LEARNER_STATE,
  STAGE_ORDER,
  type LearnerState,
  type Move,
  type Stage,
} from "../../shared/ishmael";
import { CONCEPTS, CONCEPTS_BY_ID, conceptsForStage } from "./concepts";
import { tokenize } from "./retrieval";

/**
 * מעקב אחרי איפה השיחה נמצאת — ולאן היא אמורה ללכת.
 *
 * הכלל המרכזי: לא מתקדמים שלב לפני שהמושגים המרכזיים של השלב הנוכחי
 * עומדים. מנוע שממהר קדימה מייצר הסכמה מנומסת, לא הבנה.
 */

/** נורמליזציה של מצב שהגיע מהלקוח — לעולם לא לסמוך על ה-body. */
export function normalizeLearner(raw: unknown): LearnerState {
  if (!raw || typeof raw !== "object") return { ...EMPTY_LEARNER_STATE };
  const r = raw as Record<string, unknown>;

  const ids = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .filter((x): x is string => typeof x === "string")
          .filter(id => id in CONCEPTS_BY_ID)
          .slice(0, CONCEPTS.length)
      : [];

  const stage =
    typeof r.stage === "string" && STAGE_ORDER.includes(r.stage as Stage)
      ? (r.stage as Stage)
      : "captivity";

  return {
    grasped: ids(r.grasped),
    introduced: ids(r.introduced),
    objections: Array.isArray(r.objections)
      ? r.objections
          .filter((x): x is string => typeof x === "string")
          .map(s => s.slice(0, 300))
          .slice(-10)
      : [],
    stage,
    turns: typeof r.turns === "number" && r.turns >= 0 ? Math.min(r.turns, 9999) : 0,
  };
}

/** המושגים שחייבים לעמוד כדי לצאת מהשלב — המשקל הכבד שבו. */
export function gateConcepts(stage: Stage): string[] {
  return conceptsForStage(stage)
    .filter(c => c.weight >= 0.85)
    .map(c => c.id);
}

/**
 * האם אפשר להתקדם? רק כשכל מושגי-השער של השלב נתפסו.
 * מחזיר את השלב הבא, או את הנוכחי אם עוד לא.
 */
export function advanceStage(learner: LearnerState): Stage {
  const grasped = new Set(learner.grasped);
  const gates = gateConcepts(learner.stage);
  if (gates.length > 0 && !gates.every(id => grasped.has(id))) {
    return learner.stage;
  }
  const i = STAGE_ORDER.indexOf(learner.stage);
  return STAGE_ORDER[Math.min(i + 1, STAGE_ORDER.length - 1)];
}

/** סימנים בעברית ובאנגלית לכך שהאדם מתנגד, ולא רק שואל. */
const OBJECTION_MARKERS = [
  "אבל", "לא נכון", "לא מסכים", "שטויות", "מגוחך", "הוכחה", "תוכיח",
  "למה שאאמין", "נשמע לי", "בכלל לא", "מוגזם",
  "but", "disagree", "wrong", "nonsense", "prove", "bullshit",
];

/** סימנים לכך שהאדם תפס — ולא רק אמר "אוקיי". */
const GRASP_MARKERS = [
  "הבנתי", "כלומר", "אז בעצם", "אה", "נכון", "זה מסביר", "אני רואה",
  "אז זה אומר", "בדיוק", "מעניין",
  "i see", "so basically", "that explains", "makes sense", "got it",
];

export type TurnSignals = {
  isObjection: boolean;
  showsGrasp: boolean;
  /** מזהי מושגים שהאדם ניסח בעצמו ולכן ייתכן שתפס */
  candidateGrasped: string[];
};

/**
 * קריאת התור של האדם. זו הערכה ולא ודאות — ולכן היא רק *מציעה*
 * מושגים כנתפסים; ההחלטה בפועל מתקבלת רק כשהאדם ניסח אותם בעצמו
 * (ראו markGrasped, שהמנוע קורא לו במפורש).
 */
export function readTurn(text: string, introduced: string[]): TurnSignals {
  const lower = text.toLowerCase();
  const tokens = new Set(tokenize(text));

  const isObjection = OBJECTION_MARKERS.some(m => lower.includes(m));
  const showsGrasp = GRASP_MARKERS.some(m => lower.includes(m));

  // מושג נחשב מועמד רק אם הוצג קודם *וגם* האדם השתמש במילים שלו —
  // כלומר הוא מחזיר אותו, לא שומע אותו בפעם הראשונה.
  const candidateGrasped = introduced.filter(id => {
    const c = CONCEPTS_BY_ID[id];
    if (!c) return false;
    return [c.name, c.nameEn, ...c.aliases].some(alias => {
      const at = tokenize(alias);
      return at.length > 0 && at.every(t => tokens.has(t));
    });
  });

  return { isObjection, showsGrasp, candidateGrasped };
}

/** עדכון המצב אחרי תור. טהור — מחזיר מצב חדש. */
export function applyTurn(
  learner: LearnerState,
  text: string,
  presentedConceptIds: string[]
): LearnerState {
  const signals = readTurn(text, learner.introduced);

  const introduced = Array.from(
    new Set([...learner.introduced, ...presentedConceptIds])
  );

  const grasped = new Set(learner.grasped);
  if (signals.showsGrasp) {
    for (const id of signals.candidateGrasped) grasped.add(id);
  }

  const objections = signals.isObjection
    ? [...learner.objections, text.slice(0, 300)].slice(-10)
    : learner.objections;

  const next: LearnerState = {
    grasped: [...grasped],
    introduced,
    objections,
    stage: learner.stage,
    turns: learner.turns + 1,
  };

  next.stage = advanceStage(next);
  return next;
}

/**
 * בחירת המהלך לתור הבא.
 *
 * הסדר כאן הוא סדר עדיפויות אמיתי: התנגדות נענית לפני הכל (אחרת
 * השיחה נשברת), ורק אחר כך מגיעים השיקולים הפדגוגיים.
 */
export function chooseMove(learner: LearnerState, text: string): Move {
  const signals = readTurn(text, learner.introduced);

  if (signals.isObjection) {
    // התנגדות שחוזרת פעם שנייה — סימן שהתשובה הקודמת לא נחתה.
    // אז מודים במה שנכון בה במקום ללחוץ שוב.
    return learner.objections.length >= 2 ? "concede" : "evidence";
  }
  if (signals.showsGrasp) return "name";
  if (learner.turns === 0) return "question";
  if (learner.turns % 4 === 0) return "reframe";
  if (learner.turns % 3 === 0) return "analogy";
  return "question";
}

export const MOVE_DIRECTIVES: Record<Move, string> = {
  question:
    "אל תסביר. שאל שאלה אחת שתוביל אותו לגלות את הנקודה בעצמו. שאלה אחת, לא שלוש.",
  analogy:
    "השתמש במשל או במקרה מקביל מעולם אחר. אל תשתמש במונח המקצועי לפני שהמשל עמד.",
  evidence:
    "ענה לגופו של דבר, בעובדה מהעולם ולא בציטוט. אם ההתנגדות שלו נכונה חלקית — אמור זאת קודם.",
  reframe:
    "חשוף את ההנחה שהשאלה שלו כבר מניחה. הראה לו שהשאלה עצמה נשאלה מתוך הסיפור.",
  concede:
    "הוא צודק במשהו. הודה בו במפורש ובלי סייגים, ורק אז המשך. אל תנצח בוויכוח.",
  push: "יש כאן סתירה בין שני דברים שהוא אמר. הצבע עליה בשקט ותן לו לענות.",
  name: "הוא בדיוק תיאר את הרעיון במילים שלו. תן לזה שם, בשורה אחת, והמשך.",
};
