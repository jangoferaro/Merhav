import { describe, expect, it } from "vitest";
import { EMPTY_LEARNER_STATE, type LearnerState } from "../../shared/ishmael";
import {
  advanceStage,
  applyTurn,
  chooseMove,
  gateConcepts,
  normalizeLearner,
  readTurn,
} from "./curriculum";

const learner = (over: Partial<LearnerState> = {}): LearnerState => ({
  ...EMPTY_LEARNER_STATE,
  ...over,
});

describe("normalizeLearner", () => {
  it("מחזיר מצב ריק לקלט לא תקין", () => {
    expect(normalizeLearner(null)).toEqual(EMPTY_LEARNER_STATE);
    expect(normalizeLearner("שלום")).toEqual(EMPTY_LEARNER_STATE);
  });

  it("מסנן מזהי מושגים שלא קיימים", () => {
    const s = normalizeLearner({ grasped: ["captivity", "לא-קיים", 42] });
    expect(s.grasped).toEqual(["captivity"]);
  });

  it("דוחה שלב לא חוקי ונופל לברירת המחדל", () => {
    expect(normalizeLearner({ stage: "hacked" }).stage).toBe("captivity");
  });

  it("חותך התנגדויות ארוכות ומגביל את מספרן", () => {
    const s = normalizeLearner({ objections: Array(50).fill("א".repeat(500)) });
    expect(s.objections).toHaveLength(10);
    expect(s.objections[0]).toHaveLength(300);
  });
});

describe("advanceStage", () => {
  it("לא מתקדם כשמושגי השער לא נתפסו", () => {
    expect(advanceStage(learner({ stage: "captivity" }))).toBe("captivity");
  });

  it("מתקדם כשכל מושגי השער נתפסו", () => {
    const gates = gateConcepts("captivity");
    expect(advanceStage(learner({ stage: "captivity", grasped: gates }))).toBe("story");
  });

  it("לא חורג מעבר לשלב האחרון", () => {
    const gates = gateConcepts("beyond");
    expect(advanceStage(learner({ stage: "beyond", grasped: gates }))).toBe("beyond");
  });
});

describe("readTurn", () => {
  it("מזהה התנגדות", () => {
    expect(readTurn("אבל זה פשוט לא נכון", []).isObjection).toBe(true);
  });

  it("מזהה תפיסה", () => {
    expect(readTurn("אה, הבנתי", []).showsGrasp).toBe(true);
  });

  it("מציע כמועמד רק מושג שכבר הוצג", () => {
    const before = readTurn("אז כולנו בשבי של המערכת", []);
    expect(before.candidateGrasped).toEqual([]);

    const after = readTurn("אז כולנו בשבי של המערכת", ["captivity"]);
    expect(after.candidateGrasped).toContain("captivity");
  });
});

describe("applyTurn", () => {
  it("מוסיף מושגים שהוצגו ומקדם את מונה התורות", () => {
    const s = applyTurn(learner(), "מה זה בכלל?", ["captivity", "mother-culture"]);
    expect(s.introduced).toEqual(["captivity", "mother-culture"]);
    expect(s.turns).toBe(1);
    expect(s.grasped).toEqual([]);
  });

  it("מסמן כנתפס רק כשיש גם סימן תפיסה וגם ניסוח עצמי", () => {
    const introduced = applyTurn(learner(), "נו?", ["captivity"]);
    const grasped = applyTurn(introduced, "הבנתי, אנחנו בשבי בלי לראות את זה", []);
    expect(grasped.grasped).toContain("captivity");
  });

  it("שומר התנגדות בלשון המקורית", () => {
    const s = applyTurn(learner(), "אבל אני לא מרגיש כלוא בכלל", ["captivity"]);
    expect(s.objections[0]).toContain("לא מרגיש כלוא");
  });

  it("לא משנה את המצב הקודם (טהרה)", () => {
    const before = learner();
    applyTurn(before, "משהו", ["captivity"]);
    expect(before).toEqual(EMPTY_LEARNER_STATE);
  });
});

describe("chooseMove", () => {
  it("פותח בשאלה", () => {
    expect(chooseMove(learner(), "שלום")).toBe("question");
  });

  it("עונה לגופו של דבר על התנגדות ראשונה", () => {
    expect(chooseMove(learner({ turns: 2 }), "אבל זה שטויות")).toBe("evidence");
  });

  it("מודה כשההתנגדות חוזרת שוב ושוב", () => {
    const state = learner({ turns: 5, objections: ["א", "ב"] });
    expect(chooseMove(state, "אבל עדיין לא השתכנעתי")).toBe("concede");
  });

  it("נותן שם כשהאדם ניסח את הרעיון בעצמו", () => {
    const state = learner({ turns: 3, introduced: ["captivity"] });
    expect(chooseMove(state, "הבנתי")).toBe("name");
  });
});
