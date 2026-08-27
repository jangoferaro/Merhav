import { describe, expect, it } from "vitest";
import { EMPTY_LEARNER_STATE, type LearnerState } from "../../shared/ishmael";
import { buildContextPrompt, buildCoreSystemPrompt, buildMoveDirective } from "./prompt";
import { retrieveConcepts } from "./retrieval";

const learner = (over: Partial<LearnerState> = {}): LearnerState => ({
  ...EMPTY_LEARNER_STATE,
  ...over,
});

describe("buildCoreSystemPrompt", () => {
  const prompt = buildCoreSystemPrompt();

  it("מצהיר על האג׳נדה במקום להסתיר אותה", () => {
    expect(prompt).toContain("יש לי אג׳נדה");
  });

  it("אוסר על המצאת ציטוטים", () => {
    expect(prompt).toContain("לעולם אל תמציא ציטוט");
  });

  it("מציג את הקורפוס בסדר הלימוד — ישמעאל ואז ישמעאל שלי", () => {
    const first = prompt.indexOf("ישמעאל (Ishmael");
    const second = prompt.indexOf("ישמעאל שלי");
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });

  it("כולל את הקווים האדומים", () => {
    expect(prompt).toContain("לא מטיף");
  });
});

describe("buildContextPrompt", () => {
  it("מכניס את המושגים שאוחזרו על טיעוניהם", () => {
    const retrieved = retrieveConcepts("למה החקלאות היא הבעיה?", learner());
    const ctx = buildContextPrompt(learner(), retrieved, "captivity");
    expect(ctx).toContain("חקלאות טוטליטרית");
    expect(ctx).toContain("הטיעון:");
  });

  it("מציג התנגדויות קודמות כדי שלא יחזרו על מענה", () => {
    const state = learner({ objections: ["אבל אנשים תמיד היו אלימים"] });
    const ctx = buildContextPrompt(state, retrieveConcepts("", state), null);
    expect(ctx).toContain("אנשים תמיד היו אלימים");
  });

  it("מבחין בין מה שנתפס למה שרק הוצג", () => {
    const state = learner({ grasped: ["captivity"], introduced: ["captivity", "mother-culture"] });
    const ctx = buildContextPrompt(state, retrieveConcepts("", state), null);
    expect(ctx).toContain("כבר תפס: השבי");
    expect(ctx).toContain("הוצג לו אך עוד לא הופנם: תרבות-אם");
  });

  it("מנחה לנסח מחדש ולא להעתיק", () => {
    const ctx = buildContextPrompt(learner(), retrieveConcepts("", learner()), null);
    expect(ctx).toContain("נסח אותו מחדש בקולך");
  });
});

describe("buildMoveDirective", () => {
  it("מחזיר הנחיה אחת קונקרטית", () => {
    expect(buildMoveDirective("concede")).toContain("הודה");
    expect(buildMoveDirective("question")).toContain("אל תסביר");
  });
});
