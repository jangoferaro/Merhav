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

describe("אימות המפתח לפני היציאה לרשת", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  const call = () =>
    streamLLM({ model: "m", max_tokens: 10, messages: [{ role: "user", content: "\u05d4\u05d9\u05d9" }] });

  it("\u05de\u05e4\u05ea\u05d7 \u05e2\u05dd \u05e9\u05d5\u05e8\u05d4 \u05d7\u05d3\u05e9\u05d4 \u05d1\u05e1\u05d5\u05e3 \u05de\u05e7\u05d5\u05e6\u05e5 \u05d5\u05dc\u05d0 \u05de\u05e4\u05d9\u05dc", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-abc123\n";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await call().catch(() => undefined);

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-abc123");
  });

  it("\u05ea\u05d5 \u05d1\u05e7\u05e8\u05d4 \u05d1\u05d0\u05de\u05e6\u05e2 \u05e0\u05d3\u05d7\u05d4 \u05dc\u05e4\u05e0\u05d9 \u05d4\u05e8\u05e9\u05ea", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant\u0001abc";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(call()).rejects.toThrow("\u05ea\u05d5 \u05e9\u05d0\u05d9\u05e0\u05d5 \u05d7\u05d5\u05e7\u05d9");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("\u05de\u05e4\u05ea\u05d7 \u05e9\u05db\u05d5\u05dc\u05d5 \u05e8\u05d5\u05d5\u05d7\u05d9\u05dd \u05e0\u05d7\u05e9\u05d1 \u05d7\u05e1\u05e8", async () => {
    process.env.ANTHROPIC_API_KEY = "   ";
    await expect(call()).rejects.toThrow("is not configured");
  });
});
