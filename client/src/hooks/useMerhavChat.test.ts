// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMerhavChat } from "./useMerhavChat";

/**
 * בונה Response עם גוף סטרימינג של SSE, מתוך רשימת מקטעי "data:" גולמיים.
 * כל מקטע מקבל אוטומטית "\n\n" בסופו, כמו בשרת האמיתי.
 */
function sseResponse(events: Record<string, unknown>[], ok = true) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(body, {
    status: ok ? 200 : 500,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("useMerhavChat — טיפול בכשלים בזרימה", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("מסיר בועת תשובה חלקית כשמגיע רסיס טקסט ואז שגיאת שרת, ושומר הודעה לניסיון חוזר", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { type: "safety", level: "none" },
          { type: "delta", text: "?" }, // רסיס לפני כשל — בדיוק התרחיש שדווח
          { type: "error", message: "משהו נתקע כאן לרגע. אפשר לנסות לשלוח שוב." },
        ])
      )
    );

    const { result } = renderHook(() => useMerhavChat());

    await act(async () => {
      await result.current.send("אני תקוע ולא יודע מאיפה להתחיל");
    });

    await waitFor(() => {
      // רק הודעת המשתמש נשארת — בועת ה"?" של העוזר הוסרה
      expect(result.current.messages).toHaveLength(1);
      expect(result.current.messages[0].role).toBe("user");
    });

    expect(result.current.error).toBe(
      "משהו נתקע כאן לרגע. אפשר לנסות לשלוח שוב."
    );
    expect(result.current.lastFailedMessage).toBe(
      "אני תקוע ולא יודע מאיפה להתחיל"
    );
  });

  it("retryLast שולח מחדש את ההודעה שנכשלה", async () => {
    const fetchMock = vi
      .fn()
      // ניסיון ראשון — נכשל
      .mockResolvedValueOnce(
        sseResponse([
          { type: "safety", level: "none" },
          { type: "error", message: "משהו נתקע כאן לרגע. אפשר לנסות לשלוח שוב." },
        ])
      )
      // ניסיון שני (retry) — מצליח
      .mockResolvedValueOnce(
        sseResponse([
          { type: "safety", level: "none" },
          { type: "delta", text: "אני כאן איתך." },
        ])
      );

    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useMerhavChat());

    await act(async () => {
      await result.current.send("שלום");
    });

    expect(result.current.lastFailedMessage).toBe("שלום");

    await act(async () => {
      result.current.retryLast();
      await vi.waitFor(() => {});
    });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.lastFailedMessage).toBeNull();
    });

    const lastCallBody = JSON.parse(
      fetchMock.mock.calls[1][1].body as string
    );
    expect(lastCallBody.message).toBe("שלום");
    expect(
      result.current.messages.some(m => m.content === "אני כאן איתך.")
    ).toBe(true);
  });

  it("שיחה תקינה לא מסמנת lastFailedMessage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        sseResponse([
          { type: "safety", level: "none" },
          { type: "delta", text: "היי, טוב שכתבת." },
        ])
      )
    );

    const { result } = renderHook(() => useMerhavChat());

    await act(async () => {
      await result.current.send("היי");
    });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
    });

    expect(result.current.lastFailedMessage).toBeNull();
    expect(result.current.messages).toHaveLength(2);
  });

  it("זרימה ריקה לגמרי (בלי טקסט ובלי שגיאה מפורשת) עדיין מוסרת את הבועה", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(sseResponse([{ type: "safety", level: "none" }]))
    );

    const { result } = renderHook(() => useMerhavChat());

    await act(async () => {
      await result.current.send("שלום");
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });

    expect(result.current.error).toBe("לא הגיעה תשובה. אפשר לנסות שוב.");
    expect(result.current.lastFailedMessage).toBe("שלום");
  });
});

describe("useMerhavChat — recap אוטומטי בחזרה", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("שולח recap אוטומטי כשחוזרים אחרי הפסקה עם שיחה וזיכרון קיימים", async () => {
    const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
    window.localStorage.setItem(
      "merhav.conversation.v2",
      JSON.stringify({
        messages: [
          { id: "u1", role: "user", content: "דיברנו על העבודה שלי" },
          { id: "a1", role: "assistant", content: "מה קרה שם?" },
        ],
      })
    );
    window.localStorage.setItem(
      "merhav.journey.v1",
      JSON.stringify({
        memory: {
          life: ["עובד בהייטק"],
          themes: [],
          strengths: [],
          insights: [],
          emotions: [],
          values: [],
          goals: [],
          practice: "לרשום דבר אחד שהצליח",
          lastFocus: "לחץ בעבודה",
        },
        sessionCount: 1,
        lastVisitAt: fiveHoursAgo,
        startedAt: fiveHoursAgo,
      })
    );

    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        { type: "safety", level: "none" },
        { type: "delta", text: "טוב לראות אותך שוב. איך היה עם הלחץ בעבודה?" },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useMerhavChat());

    await waitFor(() => {
      expect(
        result.current.messages.some(m => m.content.includes("איך היה"))
      ).toBe(true);
    });

    // הבקשה נשלחה בתור recap trigger, לא כהודעה רגילה
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.isRecapTrigger).toBe(true);
    expect(sentBody.isReturningVisit).toBe(true);

    // ההודעה החדשה מסומנת כתחילת מפגש, לצורך המפריד החזותי
    const recapMessage = result.current.messages.find(m =>
      m.content.includes("איך היה")
    );
    expect(recapMessage?.sessionStart).toBe(true);
  });

  it("לא שולח recap אם אין עדיין שיחה קיימת", async () => {
    const fiveHoursAgo = Date.now() - 5 * 60 * 60 * 1000;
    window.localStorage.setItem(
      "merhav.journey.v1",
      JSON.stringify({
        memory: {
          life: ["עובד בהייטק"],
          themes: [],
          strengths: [],
          insights: [],
          emotions: [],
          values: [],
          goals: [],
          practice: "",
          lastFocus: "",
        },
        sessionCount: 1,
        lastVisitAt: fiveHoursAgo,
        startedAt: fiveHoursAgo,
      })
    );

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    renderHook(() => useMerhavChat());

    // אין שיחה קודמת על המסך — אין למה לעשות recap, ומסך הפתיחה
    // הרגיל אמור לטפל בזה במקום
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
