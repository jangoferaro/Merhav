import { describe, expect, it } from "vitest";
import type { Identity } from "../../shared/ishmael";
import {
  HARD_CAP_TURNS,
  MIN_TURNS,
  countsAsPressure,
  concealmentDirective,
  resolveTurnReveal,
  revealAllowed,
  type RevealContext,
} from "./reveal";

const KNOWN: Identity = { name: "טל", gender: "male", age: 34 };

const ctx = (over: Partial<RevealContext> = {}): RevealContext => ({
  state: "concealed",
  turns: 0,
  pressure: 0,
  identity: KNOWN,
  ...over,
});

describe("countsAsPressure", () => {
  it("מזהה לחיצה על השאלה מה יושב מולו", () => {
    expect(countsAsPressure("מי אתה בכלל?")).toBe(true);
    expect(countsAsPressure("אתה בן אדם או בוט")).toBe(true);
    expect(countsAsPressure("why are you in the dark")).toBe(false);
    expect(countsAsPressure("what are you")).toBe(true);
  });

  it("לא מזהה שיחה רגילה כלחיצה", () => {
    expect(countsAsPressure("היי")).toBe(false);
    expect(countsAsPressure("אני לא מסכים איתך")).toBe(false);
  });
});

describe("revealAllowed", () => {
  it("לא מתגלה בלי זהות מלאה, גם בשיחה ארוכה", () => {
    expect(revealAllowed(ctx({ turns: 50, pressure: 9, identity: { name: "", gender: "", age: 0 } }))).toBe(false);
  });

  it("לא מתגלה מוקדם מדי גם תחת לחץ", () => {
    expect(revealAllowed(ctx({ turns: MIN_TURNS - 1, pressure: 5 }))).toBe(false);
  });

  it("מתגלה כשיש גם ותק וגם לחץ חוזר", () => {
    expect(revealAllowed(ctx({ turns: MIN_TURNS, pressure: 2 }))).toBe(true);
  });

  it("לחיצה בודדת לא מספיקה", () => {
    expect(revealAllowed(ctx({ turns: MIN_TURNS, pressure: 1 }))).toBe(false);
  });

  it("בשיחה ארוכה נפתח גם למי שלא שאל", () => {
    expect(revealAllowed(ctx({ turns: HARD_CAP_TURNS, pressure: 0 }))).toBe(true);
  });
});

describe("resolveTurnReveal", () => {
  it("בקשה שאושרה מתממשת בתור הבא", () => {
    expect(resolveTurnReveal(ctx({ turns: MIN_TURNS, pressure: 2 }), true)).toBe("revealing");
  });

  it("בקשה שלא עברה את השער לא מתממשת", () => {
    expect(resolveTurnReveal(ctx({ turns: 2, pressure: 1 }), true)).toBe("concealed");
  });

  it("תור ההתגלות נמשך תור אחד בלבד", () => {
    expect(resolveTurnReveal(ctx({ state: "revealing", turns: 9 }), false)).toBe("revealed");
  });

  it("מה שהתגלה נשאר גלוי", () => {
    expect(resolveTurnReveal(ctx({ state: "revealed", turns: 40 }), false)).toBe("revealed");
  });

  it("רשת ביטחון: שיחה שנמתחה מדי מתגלה בעצמה", () => {
    expect(resolveTurnReveal(ctx({ turns: HARD_CAP_TURNS + 4, pressure: 0 }), false)).toBe(
      "revealing"
    );
  });

  it("רשת הביטחון לא עוקפת זהות חסרה", () => {
    const anonymous = ctx({ turns: 99, identity: { name: "", gender: "", age: 0 } });
    expect(resolveTurnReveal(anonymous, true)).toBe("concealed");
  });
});

describe("concealmentDirective", () => {
  it("אוסר על משחקי ניחוש ועל תיאורי במה", () => {
    const d = concealmentDirective(ctx());
    expect(d).toContain('לא משחק ב"נחש"');
    expect(d).toContain("אתה מדבר, לא מבוים");
  });

  it("מזמין לבקש התגלות רק כשהשער פתוח", () => {
    expect(concealmentDirective(ctx({ turns: 1 }))).toContain("עוד לא הזמן");
    expect(concealmentDirective(ctx({ turns: MIN_TURNS, pressure: 2 }))).toContain("reveal:now");
  });
});
