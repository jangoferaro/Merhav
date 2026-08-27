import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * שמירה על באג שכבר קרה פעם אחת.
 *
 * הזרימה חוּוטה בטעות ל-`req.on("close")` במקום ל-`res.on("close")`.
 * `req` הוא זרם הבקשה, ו-"close" שלו נורה כשהזרם מסתיים — מיד אחרי
 * ש-express.json() קרא את הגוף, בזמן שהלקוח עדיין מחובר. התוצאה הייתה
 * שכל קריאה למודל בוטלה ברגע שהתחילה, בכל בקשה, ונראתה כלפי חוץ בדיוק
 * כמו כשל רשת — מה שעלה שלושה סבבי אבחון בכיוונים שגויים.
 */

const sse = [
  'data: {"choices":[{"delta":{"content":"שלום"}}]}',
  "",
  "data: [DONE]",
  "",
  "",
].join("\n");

const lastSignal: { current: AbortSignal | undefined } = { current: undefined };

vi.mock("../_core/llm", () => ({
  describeError: (error: unknown) => String(error),
  streamLLM: vi.fn(async ({ signal }: { signal?: AbortSignal }) => {
    lastSignal.current = signal;
    return new Response(sse, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }),
}));

import { streamLLM } from "../_core/llm";
import { registerIshmaelRoutes } from "./route";

const streamLLMMock = vi.mocked(streamLLM);

type Handler = (req: unknown, res: unknown) => Promise<void> | void;

function mountStreamRoute(): Handler {
  const routes = new Map<string, Handler>();
  const app = {
    get: (path: string, handler: Handler) => routes.set(`GET ${path}`, handler),
    post: (path: string, handler: Handler) => routes.set(`POST ${path}`, handler),
  };
  registerIshmaelRoutes(app as never);
  return routes.get("POST /api/ishmael/stream")!;
}

class FakeRes extends EventEmitter {
  chunks: string[] = [];
  ended = false;
  status() {
    return this;
  }
  setHeader() {
    return this;
  }
  flushHeaders() {}
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.ended = true;
  }
  json() {
    return this;
  }
  get body() {
    return this.chunks.join("");
  }
}

describe("ניתוק לקוח בזרימת ישמעאל", () => {
  let handler: Handler;

  beforeEach(() => {
    handler = mountStreamRoute();
  });

  it("סיום זרם הבקשה לא מבטל את הקריאה למודל", async () => {
    const req = new EventEmitter() as EventEmitter & { body: unknown };
    req.body = { message: "היי" };
    const res = new FakeRes();

    const done = handler(req, res);

    // בדיוק מה ש-express.json() גורם לו: זרם הבקשה נגמר מיד, בזמן
    // שהלקוח עדיין מחובר ומחכה לתשובה.
    req.emit("close");

    await done;

    expect(res.body).toContain('"type":"delta"');
    expect(res.body).toContain("שלום");
    expect(res.body).not.toContain('"type":"error"');
  });

  it("ניתוק באמצע הזרימה מבטל את האות", async () => {
    // זרם שנשאר פתוח, כדי שהראוט יהיה באמת באמצע קריאה כשהלקוח עוזב
    let release!: () => void;
    const held = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse.split("\n")[0] + "\n\n"));
        release = () => controller.close();
      },
    });
    streamLLMMock.mockImplementationOnce(async ({ signal }: { signal?: AbortSignal }) => {
      lastSignal.current = signal;
      return new Response(held, { status: 200 });
    });

    const req = new EventEmitter() as EventEmitter & { body: unknown };
    req.body = { message: "היי" };
    const res = new FakeRes();

    const done = handler(req, res);
    await new Promise(resolve => setImmediate(resolve));

    expect(lastSignal.current?.aborted).toBe(false);
    res.emit("close");
    expect(lastSignal.current?.aborted).toBe(true);

    release();
    await done;
  });

  it("סיום זרם הבקשה משאיר את האות פעיל", async () => {
    const req = new EventEmitter() as EventEmitter & { body: unknown };
    req.body = { message: "היי" };
    const res = new FakeRes();

    const done = handler(req, res);
    req.emit("close");
    await done;

    expect(lastSignal.current?.aborted).toBe(false);
  });

  it("המאזין רשום על התשובה ולא על הבקשה", async () => {
    const req = new EventEmitter() as EventEmitter & { body: unknown };
    req.body = { message: "היי" };
    const res = new FakeRes();

    await handler(req, res);

    expect(res.listenerCount("close")).toBeGreaterThan(0);
    expect(req.listenerCount("close")).toBe(0);
  });
});
