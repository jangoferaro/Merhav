import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeError, streamLLM } from "./llm";

describe("describeError", () => {
  it("חושף את הסיבה שעטופה ב-cause", () => {
    // זו בדיוק הצורה ש-Node מחזיר: ההודעה חסרת ערך, הסיבה היא העיקר
    const error = new Error("fetch failed", {
      cause: new Error("getaddrinfo ENOTFOUND api.anthropic.com"),
    });
    expect(describeError(error)).toContain("ENOTFOUND");
    expect(describeError(error)).toContain("fetch failed");
  });

  it("עובד גם בלי cause", () => {
    expect(describeError(new TypeError("Invalid header value"))).toBe(
      "TypeError: Invalid header value"
    );
  });

  it("לא נופל על ערך שאינו שגיאה", () => {
    expect(describeError("משהו")).toBe("משהו");
  });
});

describe("streamLLM — ניסיונות חוזרים", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it("ביטול לא נחשב כשל רשת ולא נספר כניסיון חוזר", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";

    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      streamLLM({ model: "m", max_tokens: 10, messages: [{ role: "user", content: "היי" }] })
    ).rejects.toThrow("aborted");

    // לפני התיקון זה היה חמישה סיבובים שקוברים את הסיבה האמיתית
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("כשל רשת אמיתי כן מנוסה שוב", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error("fetch failed", { cause: new Error("ECONNREFUSED") }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      streamLLM({ model: "m", max_tokens: 10, messages: [{ role: "user", content: "היי" }] })
    ).rejects.toThrow();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    // הבדיקה מריצה backoff אמיתי, ולכן היא איטית מברירת המחדל
  }, 20_000);
});
