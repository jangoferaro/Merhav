import { describe, expect, it } from "vitest";
import { EMPTY_LEARNER_STATE, type LearnerState } from "../../shared/ishmael";
import { nextTeachable, normalizeToken, retrieveConcepts, scoreConcept, tokenize } from "./retrieval";
import { CONCEPTS_BY_ID } from "./concepts";

const learner = (over: Partial<LearnerState> = {}): LearnerState => ({
  ...EMPTY_LEARNER_STATE,
  ...over,
});

describe("normalizeToken", () => {
  it("מקלף תחילית עברית כשנשארת מילה סבירה", () => {
    expect(normalizeToken("והחקלאות")).toBe("החקלאות");
    expect(normalizeToken("בחקלאות")).toBe("חקלאות");
  });

  it("לא מקלף כשהמילה תתקצר מדי", () => {
    expect(normalizeToken("שבט")).toBe("שבט");
    expect(normalizeToken("הר")).toBe("הר");
  });

  it("מנרמל אנגלית לאותיות קטנות", () => {
    expect(normalizeToken("Takers")).toBe("takers");
  });
});

describe("tokenize", () => {
  it("מפריד לפי סימנים ומסנן אסימונים קצרים", () => {
    expect(tokenize("חקלאות, קדמה — ו')")).toContain("חקלאות");
    expect(tokenize("a bb ccc")).toEqual(["bb", "ccc"]);
  });
});

describe("scoreConcept", () => {
  it("ביטוי שלם מקבל יותר ממילה בודדת מתוכו", () => {
    const c = CONCEPTS_BY_ID["law-of-limited-competition"];
    const full = scoreConcept(tokenize("חוק התחרות המוגבלת"), c);
    const partial = scoreConcept(tokenize("תחרות"), c);
    expect(full).toBeGreaterThan(partial);
  });

  it("טקסט לא קשור מקבל אפס", () => {
    expect(scoreConcept(tokenize("מתכון לעוגת גבינה"), CONCEPTS_BY_ID["animism"])).toBe(0);
  });
});

describe("retrieveConcepts", () => {
  it("מאחזר את המושג שהוזכר במפורש", () => {
    const ids = retrieveConcepts("למה החקלאות היא הבעיה?", learner()).map(r => r.concept.id);
    expect(ids).toContain("totalitarian-agriculture");
  });

  it("עובד גם באנגלית", () => {
    const ids = retrieveConcepts("what is the great forgetting", learner()).map(r => r.concept.id);
    expect(ids).toContain("great-forgetting");
  });

  it("מוסיף תנאים מוקדמים שעדיין לא נתפסו", () => {
    const got = retrieveConcepts("חוק התחרות המוגבלת", learner());
    const ids = got.map(r => r.concept.id);
    expect(ids).toContain("law-of-limited-competition");
    // החוק דורש leaver + חקלאות טוטליטרית, שדורשים בתורם את שאר השרשרת
    expect(ids).toContain("leaver");
    expect(got.some(r => r.reason === "prerequisite")).toBe(true);
  });

  it("לא מוסיף תנאי מוקדם שכבר נתפס", () => {
    const got = retrieveConcepts(
      "חוק התחרות המוגבלת",
      learner({ grasped: ["leaver", "taker", "story-enactment", "mother-culture", "captivity"] })
    );
    expect(got.some(r => r.concept.id === "captivity" && r.reason === "prerequisite")).toBe(false);
  });

  it("מחזיר מושגי השלב הנוכחי גם בלי התאמה טקסטואלית", () => {
    const ids = retrieveConcepts("שלום", learner({ stage: "law" })).map(r => r.concept.id);
    expect(ids).toContain("law-of-limited-competition");
  });
});

describe("nextTeachable", () => {
  it("מתחיל מהשורש כשלא נתפס דבר", () => {
    expect(nextTeachable(learner())?.id).toBe("captivity");
  });

  it("עובר הלאה אחרי שהשורש נתפס", () => {
    const next = nextTeachable(learner({ grasped: ["captivity"], stage: "story" }));
    expect(next?.id).toBe("mother-culture");
  });

  it("לא מציע מושג שהתנאים המוקדמים שלו חסרים", () => {
    // השלב הוא "law", אבל שום מושג לא נתפס — אז המנוע חוזר לשורש
    // במקום להציע את חוק התחרות המוגבלת, שדורש שרשרת שלמה לפניו.
    const next = nextTeachable(learner({ stage: "law" }));
    expect(next?.id).toBe("captivity");
    expect(next?.requires).toEqual([]);
  });

  it("מחזיר null כשהכל נתפס", () => {
    const all = Object.keys(CONCEPTS_BY_ID);
    expect(nextTeachable(learner({ grasped: all, stage: "beyond" }))).toBeNull();
  });
});
