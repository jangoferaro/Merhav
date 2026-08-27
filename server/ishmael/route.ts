import type { Express, Request, Response } from "express";
import { streamLLM, type Message } from "../_core/llm";
import {
  ISHMAEL_MAX_HISTORY_MESSAGES,
  ISHMAEL_MAX_MESSAGE_LENGTH,
  type LearnerState,
} from "../../shared/ishmael";
import { CONCEPTS } from "./concepts";
import { CORPUS } from "./corpus";
import { applyTurn, chooseMove, normalizeLearner } from "./curriculum";
import {
  OPENING_DIRECTIVE,
  buildContextPrompt,
  buildCoreSystemPrompt,
  buildMoveDirective,
} from "./prompt";
import { nextTeachable, retrieveConcepts } from "./retrieval";
import { loadGrounding, renderGrounding } from "./ingest";

const MODEL = process.env.ISHMAEL_MODEL || process.env.CHAT_MODEL || "claude-sonnet-5";
const MAX_TOKENS = 900;
const STREAM_TIMEOUT_MS = 30_000;

type Turn = { role: "user" | "assistant"; content: string };

export function sanitizeIshmaelHistory(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Turn => {
      if (!m || typeof m !== "object") return false;
      const c = m as Record<string, unknown>;
      return (
        (c.role === "user" || c.role === "assistant") &&
        typeof c.content === "string" &&
        c.content.trim().length > 0
      );
    })
    .map(m => ({ role: m.role, content: m.content.slice(0, ISHMAEL_MAX_MESSAGE_LENGTH) }))
    .slice(-ISHMAEL_MAX_HISTORY_MESSAGES);
}

/**
 * הרכבת הפניה למודל. מופרד מהראוט כדי שאפשר יהיה לבדוק אותו בלי רשת:
 * מה שנכנס לפרומפט הוא ההתנהגות של המנוע, ולכן הוא מה שצריך להיבדק.
 */
export function buildIshmaelMessages(
  history: Turn[],
  userMessage: string,
  learner: LearnerState,
  isOpening: boolean
): { messages: Message[]; presented: string[] } {
  const retrieved = isOpening
    ? retrieveConcepts("", learner, 4)
    : retrieveConcepts([userMessage, ...history.slice(-4).map(h => h.content)].join(" "), learner);

  const next = nextTeachable(learner);
  const grounding = renderGrounding(loadGrounding(), userMessage);

  const messages: Message[] = [
    { role: "system", content: buildCoreSystemPrompt() },
    {
      role: "system",
      content: buildContextPrompt(learner, retrieved, next ? next.id : null),
    },
  ];

  if (grounding) {
    messages.push({ role: "system", content: grounding });
  }

  for (const t of history) messages.push({ role: t.role, content: t.content });

  messages.push({
    role: "user",
    content: isOpening
      ? "(האדם פתח את השיחה ועדיין לא כתב כלום — טריגר פנימי, לא הודעה ממנו)"
      : userMessage,
  });

  messages.push({
    role: "system",
    content: isOpening
      ? OPENING_DIRECTIVE
      : buildMoveDirective(chooseMove(learner, userMessage)),
  });

  return { messages, presented: retrieved.map(r => r.concept.id) };
}

function writeEvent(res: Response, payload: Record<string, unknown>) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function registerIshmaelRoutes(app: Express) {
  /** מפת הידע — מאפשרת ללקוח להציג את הגרף ואת מצב ההתקדמות. */
  app.get("/api/ishmael/knowledge", (_req: Request, res: Response) => {
    res.json({
      works: CORPUS.map(w => ({
        id: w.id,
        title: w.title,
        titleHe: w.titleHe,
        year: w.year,
        teachingOrder: w.teachingOrder,
        role: w.role,
        adds: w.adds,
      })),
      concepts: CONCEPTS.map(c => ({
        id: c.id,
        name: c.name,
        nameEn: c.nameEn,
        stage: c.stage,
        home: c.home,
        definition: c.definition,
        requires: c.requires,
      })),
      grounding: loadGrounding().map(d => ({
        title: d.title,
        chunks: d.chunks.length,
      })),
    });
  });

  app.post("/api/ishmael/stream", async (req: Request, res: Response) => {
    const body = (req.body || {}) as Record<string, unknown>;
    const isOpening = body.isOpening === true;

    let userMessage = "";
    if (!isOpening) {
      const raw = typeof body.message === "string" ? body.message.trim() : "";
      if (!raw) {
        res.status(400).json({ error: "ההודעה ריקה." });
        return;
      }
      userMessage = raw.slice(0, ISHMAEL_MAX_MESSAGE_LENGTH);
    }

    const history = sanitizeIshmaelHistory(body.history);
    const learner = normalizeLearner(body.learner);
    const { messages, presented } = buildIshmaelMessages(
      history,
      userMessage,
      learner,
      isOpening
    );

    // המצב מתעדכן מהתור של האדם, לא מהתשובה — כדי שהלקוח יקבל אותו
    // מיד ולא יחכה לסוף הזרימה.
    const nextLearner = isOpening
      ? { ...learner, introduced: presented }
      : applyTurn(learner, userMessage, presented);

    res.status(200);
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("connection", "keep-alive");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders?.();

    writeEvent(res, { type: "state", learner: nextLearner, concepts: presented });

    let finished = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      if (!finished) controller.abort();
    }, STREAM_TIMEOUT_MS);

    req.on("close", () => {
      if (!finished) controller.abort();
    });

    try {
      const upstream = await streamLLM({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages,
        signal: controller.signal,
      });

      const reader = upstream.body?.getReader();
      if (!reader) throw new Error("No response body from LLM");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const text = parsed.choices?.[0]?.delta?.content;
            if (text) writeEvent(res, { type: "delta", content: text });
          } catch {
            // רסיס SSE חלקי — יושלם בלולאה הבאה
          }
        }
      }

      finished = true;
      writeEvent(res, { type: "done" });
    } catch (error) {
      finished = true;
      console.error("ishmael stream failed:", error);
      writeEvent(res, {
        type: "error",
        message: "משהו נקטע באמצע. אפשר לנסות שוב.",
      });
    } finally {
      clearTimeout(timeout);
      res.end();
    }
  });
}
