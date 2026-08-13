import type { Express, Request, Response } from "express";
import { invokeLLM, streamLLM, type Message } from "./_core/llm";
import {
  ACUTE_SAFETY_DIRECTIVE,
  CONTEXTUAL_STARTERS_PROMPT,
  ELEVATED_SAFETY_DIRECTIVE,
  RECAP_DIRECTIVE,
  SYSTEM_PROMPT,
} from "./prompt";
import { assessConversationSafety } from "./safety";
import { buildMemoryContext, extractMemory, normalizeMemory } from "./memory";
import { buildProfileContext, normalizeProfile } from "./profile";
import { MAX_HISTORY_MESSAGES, MAX_MESSAGE_LENGTH } from "../shared/merhav";

// שם מודל אמיתי מ-Anthropic. אפשר לשנות דרך CHAT_MODEL בסביבה.
const MODEL = process.env.CHAT_MODEL || "claude-sonnet-5";
const MAX_TOKENS = 700;

type IncomingMessage = { role: "user" | "assistant"; content: string };

/** הגבלת קצב בסיסית לפי IP — האפליקציה פתוחה לכולם וללא הרשמה. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateBuckets = new Map<string, number[]>();

/**
 * המפתח הוא גיבוב לא הפיך של הכתובת, כדי לאפשר הגבלת קצב
 * בלי להחזיק כתובת אמיתית בזיכרון. אין הרשמה ואין זיהוי אישי.
 */
export function bucketKey(ip: string): string {
  let hash = 2166136261;
  for (let i = 0; i < ip.length; i++) {
    hash ^= ip.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function isRateLimited(rawIp: string): boolean {
  const ip = bucketKey(rawIp);
  const now = Date.now();
  const hits = (rateBuckets.get(ip) || []).filter(
    t => now - t < RATE_LIMIT_WINDOW_MS
  );
  hits.push(now);
  rateBuckets.set(ip, hits);

  if (rateBuckets.size > 5000) {
    rateBuckets.forEach((times: number[], key: string) => {
      if (times.every((t: number) => now - t >= RATE_LIMIT_WINDOW_MS)) {
        rateBuckets.delete(key);
      }
    });
  }

  return hits.length > RATE_LIMIT_MAX_REQUESTS;
}

export function sanitizeHistory(raw: unknown): IncomingMessage[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((m): m is IncomingMessage => {
      if (!m || typeof m !== "object") return false;
      const candidate = m as Record<string, unknown>;
      return (
        (candidate.role === "user" || candidate.role === "assistant") &&
        typeof candidate.content === "string" &&
        candidate.content.trim().length > 0
      );
    })
    .map(m => ({
      role: m.role,
      content: m.content.slice(0, MAX_MESSAGE_LENGTH),
    }))
    .slice(-MAX_HISTORY_MESSAGES);
}

export type ValidationResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/** ולידציה של ההודעה הנכנסת — ריקה נדחית, ארוכה מדי נחתכת. */
export function validateIncomingMessage(raw: unknown): ValidationResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "ההודעה ריקה." };
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "ההודעה ריקה." };
  }

  return { ok: true, message: trimmed.slice(0, MAX_MESSAGE_LENGTH) };
}

export function buildMessages(
  history: IncomingMessage[],
  userMessage: string,
  safetyLevel: "none" | "elevated" | "acute",
  memoryContext: string | null = null,
  profileContext: string | null = null,
  isRecapTrigger = false
): Message[] {
  const messages: Message[] = [{ role: "system", content: SYSTEM_PROMPT }];

  if (profileContext) {
    messages.push({ role: "system", content: profileContext });
  }

  if (memoryContext) {
    messages.push({ role: "system", content: memoryContext });
  }

  for (const item of history) {
    messages.push({ role: item.role, content: item.content });
  }

  messages.push({ role: "user", content: userMessage });

  if (isRecapTrigger) {
    messages.push({ role: "system", content: RECAP_DIRECTIVE });
  }

  if (safetyLevel === "acute") {
    messages.push({ role: "system", content: ACUTE_SAFETY_DIRECTIVE });
  } else if (safetyLevel === "elevated") {
    messages.push({ role: "system", content: ELEVATED_SAFETY_DIRECTIVE });
  }

  return messages;
}

function writeEvent(res: Response, payload: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function registerChatRoute(app: Express) {
  app.post("/api/chat/stream", async (req: Request, res: Response) => {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    if (isRateLimited(ip)) {
      res.status(429).json({ error: "יש רגע להמתין. נסה שוב בעוד דקה." });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const isRecapTrigger = body.isRecapTrigger === true;

    let userMessage: string;
    if (isRecapTrigger) {
      // אין הודעת משתמש אמיתית — זה טריגר פנימי שגורם לעוזר לפתוח
      // ביוזמתו. הטקסט הזה לא מוצג למשתמש בשום מקום, הוא קיים רק
      // כי ל-API יש צורך בתור user לפני שהעוזר יכול לענות.
      userMessage =
        "(האדם פתח את השיחה מחדש ועדיין לא כתב כלום — זהו טריגר פנימי, לא הודעה אמיתית ממנו)";
    } else {
      const validation = validateIncomingMessage(body.message);
      if (!validation.ok) {
        res.status(400).json({ error: validation.error });
        return;
      }
      userMessage = validation.message;
    }

    const history = sanitizeHistory(body.history);
    const recentUserMessages = history
      .filter(m => m.role === "user")
      .map(m => m.content);

    // ב-recap אין תוכן אמיתי להעריך — אין סיבה שדפוס ישן בהיסטוריה
    // "ידביק" רמת בטיחות לפתיחה יזומה שלא אמרה כלום.
    const safety = isRecapTrigger
      ? ({ level: "none" as const })
      : assessConversationSafety(userMessage, recentUserMessages);

    const memory = normalizeMemory(body.memory);
    const isReturningVisit = isRecapTrigger || body.isReturningVisit === true;
    const memoryContext = buildMemoryContext(memory, isReturningVisit);
    const profileContext = buildProfileContext(normalizeProfile(body.profile));

    res.status(200);
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders?.();

    // הלקוח מקבל את דרגת הבטיחות מיד, כדי להציג את כרטיס קווי הסיוע
    // בלי לחכות שהמודל יסיים לכתוב.
    writeEvent(res, { type: "safety", level: safety.level });

    let finished = false;
    const controller = new AbortController();

    // אם הזרימה מהמודל נתקעת (לא שולחת כלום ולא נסגרת), לא נחכה לנצח —
    // מבטלים ומדווחים על שגיאה, כדי שהלקוח לא יישאר עם בועה תלויה.
    const IDLE_TIMEOUT_MS = 20_000;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!finished) controller.abort();
      }, IDLE_TIMEOUT_MS);
    };

    res.on("close", () => {
      if (!finished) {
        finished = true;
        controller.abort();
      }
      if (idleTimer) clearTimeout(idleTimer);
    });

    try {
      const upstream = await streamLLM({
        model: MODEL,
        messages: buildMessages(
          history,
          userMessage,
          safety.level,
          memoryContext,
          profileContext,
          isRecapTrigger
        ),
        max_tokens: MAX_TOKENS,
        signal: controller.signal,
      });

      const reader = upstream.body?.getReader();
      if (!reader) {
        throw new Error("No response body from LLM");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      resetIdleTimer();

      while (!finished) {
        const { done, value } = await reader.read();
        resetIdleTimer();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              writeEvent(res, { type: "delta", text: delta });
            }
          } catch {
            // חלקי SSE שבורים — מדלגים בשקט
          }
        }
      }

      if (!finished) {
        writeEvent(res, { type: "done" });
      }
    } catch (error) {
      console.error("[chat] stream error:", error);
      if (!finished && !res.writableEnded) {
        // מיצוי מגבלת שימוש הוא מצב אחר מתקלה זמנית, וכדאי לומר זאת בכנות
        const message = String((error as Error)?.message || "");
        const exhausted =
          message.includes("usage exhausted") || message.includes("412");

        writeEvent(res, {
          type: "error",
          message: exhausted
            ? "המרחב עמוס כרגע ולא מצליח לענות. כדאי לנסות שוב בהמשך."
            : "משהו נתקע כאן לרגע. אפשר לנסות לשלוח שוב.",
        });
      }
    } finally {
      finished = true;
      if (idleTimer) clearTimeout(idleTimer);
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  /**
   * חילוץ הזיכרון. נקרא מהלקוח אחרי שהתשובה הושלמה, כדי שלא
   * יעכב את הסטרימינג. הזיכרון עצמו נשמר במכשיר, לא כאן.
   */
  app.post("/api/journey/memory", async (req: Request, res: Response) => {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    if (isRateLimited(ip)) {
      res.status(429).json({ error: "יש רגע להמתין." });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const existing = normalizeMemory(body.memory);
    const turns = sanitizeHistory(body.turns);

    if (turns.length === 0) {
      res.status(200).json({ memory: existing });
      return;
    }

    const updated = await extractMemory(existing, turns);
    res.status(200).json({ memory: updated ?? existing });
  });

  /**
   * הצעות תגובה קצרות ורלוונטיות אחרי recap — במקום כפתורי הפתיחה
   * הגנריים. נכשל בשקט (מחזיר מערך ריק) כי זה שיפור, לא הכרחי.
   */
  app.post("/api/journey/starters", async (req: Request, res: Response) => {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    if (isRateLimited(ip)) {
      res.status(429).json({ error: "יש רגע להמתין." });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const recapText =
      typeof body.recapText === "string" ? body.recapText.trim() : "";

    if (recapText.length === 0) {
      res.status(200).json({ starters: [] });
      return;
    }

    try {
      const prompt = CONTEXTUAL_STARTERS_PROMPT.replace(
        "{{RECAP_TEXT}}",
        recapText.slice(0, 1000)
      );
      const response = await invokeLLM({
        model: process.env.MEMORY_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      });

      const raw = response.choices?.[0]?.message?.content;
      const text = typeof raw === "string" ? raw : "";
      const cleaned = text.replace(/```json|```/g, "").trim();
      const parsed: unknown = JSON.parse(cleaned);

      const starters = Array.isArray(parsed)
        ? parsed
            .filter((s): s is string => typeof s === "string")
            .map(s => s.trim().slice(0, 60))
            .filter(s => s.length > 0)
            .slice(0, 3)
        : [];

      res.status(200).json({ starters });
    } catch (error) {
      console.error("[chatRoute] contextual starters failed:", error);
      res.status(200).json({ starters: [] });
    }
  });
}
