import { describe, expect, it } from "vitest";
import { currentPhase, phaseFromAltitude, phaseFromHour, sunAltitude } from "./daylight";

// תל אביב
const TLV = { latitude: 32.08, longitude: 34.78 };

describe("phaseFromHour", () => {
  it("ממפה שעות לשלבים", () => {
    expect(phaseFromHour(2)).toBe("night");
    expect(phaseFromHour(6)).toBe("dawn");
    expect(phaseFromHour(12)).toBe("day");
    expect(phaseFromHour(18)).toBe("dusk");
    expect(phaseFromHour(23)).toBe("night");
  });

  it("הגבולות שייכים לשלב שמתחיל בהם", () => {
    expect(phaseFromHour(5)).toBe("dawn");
    expect(phaseFromHour(8)).toBe("day");
    expect(phaseFromHour(17)).toBe("dusk");
    expect(phaseFromHour(20)).toBe("night");
  });
});

describe("phaseFromAltitude", () => {
  it("אותו גובה מתפרש כשחר או כדמדומים לפי כיוון התנועה", () => {
    expect(phaseFromAltitude(-2, true)).toBe("dawn");
    expect(phaseFromAltitude(-2, false)).toBe("dusk");
  });

  it("שמש גבוהה היא יום, ושמש עמוק מתחת לאופק היא לילה", () => {
    expect(phaseFromAltitude(45, false)).toBe("day");
    expect(phaseFromAltitude(-30, false)).toBe("night");
  });
});

describe("sunAltitude", () => {
  it("צהרי יוני בתל אביב — שמש גבוהה", () => {
    const alt = sunAltitude(new Date("2026-06-21T09:39:00Z"), TLV.latitude, TLV.longitude);
    expect(alt).toBeGreaterThan(75);
  });

  it("חצות בתל אביב — שמש הרבה מתחת לאופק", () => {
    const alt = sunAltitude(new Date("2026-06-21T21:39:00Z"), TLV.latitude, TLV.longitude);
    expect(alt).toBeLessThan(-20);
  });

  it("בקיץ בקוטב הצפוני השמש לא שוקעת", () => {
    const alt = sunAltitude(new Date("2026-06-21T00:00:00Z"), 78, 15);
    expect(alt).toBeGreaterThan(0);
  });
});

describe("currentPhase", () => {
  it("בלי מיקום נופל לספי השעות המקומיות", () => {
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    expect(currentPhase(noon, null)).toBe("day");
  });

  it("עם מיקום מזהה לילה גם בשעה שנראית 'ערב' בשעון", () => {
    // 21:39 מקומי בתל אביב ביוני — השעון אומר ערב, השמיים אומרים לילה
    expect(currentPhase(new Date("2026-06-21T18:39:00Z"), TLV)).toBe("night");
  });
});
