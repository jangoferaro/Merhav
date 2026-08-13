import { describe, expect, it } from "vitest";
import { buildMemoryContext, normalizeMemory } from "./memory";
import { EMPTY_MEMORY, MEMORY_LIMITS, isMemoryEmpty } from "../shared/merhav";

describe("normalizeMemory", () => {
  it("מחזיר זיכרון ריק לקלט לא תקין", () => {
    expect(normalizeMemory(null)).toEqual(EMPTY_MEMORY);
    expect(normalizeMemory("טקסט")).toEqual(EMPTY_MEMORY);
    expect(normalizeMemory(undefined)).toEqual(EMPTY_MEMORY);
  });

  it("מסנן פריטים שאינם מחרוזות ופריטים ריקים", () => {
    const result = normalizeMemory({
      life: ["מנהל צוות", "", 42, null, "גר בחיפה"],
      themes: "לא מערך",
    });
    expect(result.life).toEqual(["מנהל צוות", "גר בחיפה"]);
    expect(result.themes).toEqual([]);
  });

  it("מסיר כפילויות", () => {
    const result = normalizeMemory({
      strengths: ["ניסה שלוש פעמים", "ניסה שלוש פעמים"],
    });
    expect(result.strengths).toEqual(["ניסה שלוש פעמים"]);
  });

  it("מגביל את מספר הפריטים ושומר את החדשים", () => {
    const many = Array.from({ length: 20 }, (_, i) => `פריט ${i}`);
    const result = normalizeMemory({ life: many });
    expect(result.life).toHaveLength(MEMORY_LIMITS.life);
    expect(result.life[result.life.length - 1]).toBe("פריט 19");
  });

  it("חותך פריטים ארוכים מדי", () => {
    const result = normalizeMemory({ life: ["א".repeat(500)] });
    expect(result.life[0].length).toBeLessThanOrEqual(180);
  });

  it("מנקה שדות טקסט", () => {
    const result = normalizeMemory({
      practice: "  לרשום דבר אחד  ",
      lastFocus: 99,
    });
    expect(result.practice).toBe("לרשום דבר אחד");
    expect(result.lastFocus).toBe("");
  });

  it("מנקה ומגביל את קטגוריות הזיכרון החדשות (רגשות, ערכים, מטרות)", () => {
    const result = normalizeMemory({
      emotions: ["בושה כשמאכזב מישהו", "בושה כשמאכזב מישהו", "חרדה לפני פגישות"],
      values: ["נאמנות לאנשים שהוא אוהב"],
      goals: ["לרוץ חצי מרתון", "", 5],
    });
    expect(result.emotions).toEqual([
      "בושה כשמאכזב מישהו",
      "חרדה לפני פגישות",
    ]);
    expect(result.values).toEqual(["נאמנות לאנשים שהוא אוהב"]);
    expect(result.goals).toEqual(["לרוץ חצי מרתון"]);
  });
});

describe("buildMemoryContext", () => {
  it("מחזיר null כשאין זיכרון, כדי שהמנוע לא יתחזה להיכרות", () => {
    expect(buildMemoryContext(EMPTY_MEMORY, false)).toBeNull();
    expect(buildMemoryContext(EMPTY_MEMORY, true)).toBeNull();
  });

  it("כולל את תכני הזיכרון בהקשר", () => {
    const context = buildMemoryContext(
      {
        ...EMPTY_MEMORY,
        life: ["מנהל צוות בחברת תוכנה"],
        strengths: ["נשאר עד עשר שלושה לילות"],
        practice: "לרשום דבר אחד שהצליח",
        lastFocus: "דדליין שלא עמד בו",
      },
      false
    );

    expect(context).toContain("מנהל צוות בחברת תוכנה");
    expect(context).toContain("נשאר עד עשר שלושה לילות");
    expect(context).toContain("לרשום דבר אחד שהצליח");
    expect(context).toContain("דדליין שלא עמד בו");
  });

  it("כולל רגשות חוזרים, ערכים ומטרות כשיש", () => {
    const context = buildMemoryContext(
      {
        ...EMPTY_MEMORY,
        emotions: ["חרדה לפני פגישות"],
        values: ["נאמנות לאנשים שהוא אוהב"],
        goals: ["לרוץ חצי מרתון"],
      },
      false
    );

    expect(context).toContain("חרדה לפני פגישות");
    expect(context).toContain("נאמנות לאנשים שהוא אוהב");
    expect(context).toContain("לרוץ חצי מרתון");
  });

  it("מנחה לפתיחה מתייחסת כשזו חזרה אחרי הפסקה", () => {
    const context = buildMemoryContext(
      { ...EMPTY_MEMORY, lastFocus: "השיחה עם אחותו" },
      true
    );
    expect(context).toContain("חזרה שלו אחרי הפסקה");
  });

  it("מנחה להמשכיות כשהשיחה נמשכת באותו מפגש", () => {
    const context = buildMemoryContext(
      { ...EMPTY_MEMORY, lastFocus: "השיחה עם אחותו" },
      false
    );
    expect(context).toContain("השיחה נמשכת");
  });

  it("מורה למנוע לא להציג את הרשימה למשתמש", () => {
    const context = buildMemoryContext(
      { ...EMPTY_MEMORY, life: ["גר בתל אביב"] },
      false
    );
    expect(context).toContain("אל תציג את הרשימה");
  });
});

describe("isMemoryEmpty", () => {
  it("מזהה זיכרון ריק", () => {
    expect(isMemoryEmpty(EMPTY_MEMORY)).toBe(true);
  });

  it("מזהה זיכרון עם תוכן", () => {
    expect(isMemoryEmpty({ ...EMPTY_MEMORY, life: ["עובד מהבית"] })).toBe(
      false
    );
    expect(isMemoryEmpty({ ...EMPTY_MEMORY, lastFocus: "משהו" })).toBe(false);
  });
});
