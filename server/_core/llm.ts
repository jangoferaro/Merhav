import { ENV } from "./env";

/**
 * שכבת גישה למודל. הממשק הציבורי (invokeLLM / streamLLM) נשאר בצורת
 * "OpenAI chat.completions" מכוונת — כך ש-chatRoute.ts ו-memory.ts לא
 * צריכים לדעת כלום על זה — אבל מתחת למכסה זה מדבר עם Anthropic
 * Messages API (https://api.anthropic.com/v1/messages) ומתרגם בשני
 * הכיוונים. אם תרצו לעבור לספק אחר בעתיד, זה המקום היחיד לשנות.
 *
 * הערה: התמיכה כאן מכוונת בדיוק למה שהאפליקציה הזו בפועל שולחת —
 * הודעות טקסט בלבד, בלי כלים (tools) ובלי תוכן מולטימודלי. אם תרצו
 * להוסיף את זה, כאן המקום.
 */

export type Role = "system" | "user" | "assistant";

export type Message = {
  role: Role;
  content: string;
};

export type InvokeParams = {
  messages: Message[];
  model?: string;
  maxTokens?: number;
  max_tokens?: number;
  response_format?: { type: "json_schema"; json_schema: unknown } | { type: "text" } | { type: "json_object" };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

const ANTHROPIC_VERSION = "2023-06-01";

const resolveApiUrl = () =>
  `${ENV.apiBaseUrl.replace(/\/$/, "")}/v1/messages`;

const assertApiKey = () => {
  if (!ENV.apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. הגדירו אותו במשתני הסביבה (ראו .env.example)."
    );
  }
};

const authHeaders = () => ({
  "content-type": "application/json",
  "x-api-key": ENV.apiKey,
  "anthropic-version": ANTHROPIC_VERSION,
});

/**
 * Anthropic דורש system כשדה נפרד ברמה העליונה, לא כהודעה בתוך
 * המערך, ודורש שההודעות יתחילו ב-user. פונקציה זו מפרידה את כל
 * הודעות ה-"system" (מאוחדות בסדר שהופיעו) מיתר השיחה.
 */
function splitSystemAndTurns(messages: Message[]): {
  system: string | undefined;
  turns: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systemParts: string[] = [];
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      turns.push({ role: m.role, content: m.content });
    }
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n---\n\n") : undefined,
    turns,
  };
}

const RETRY_MAX_RETRIES = 4;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 30_000;

const sleep = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

const parseRetryAfter = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
};

// Equal-jitter exponential backoff. The cap/2 floor guarantees a minimum
// delay so a misbehaving caller loop slows down instead of hammering the
// upstream while it keeps returning errors.
const computeBackoffDelay = (
  attempt: number,
  retryAfterMs?: number
): number => {
  const cap = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
  const jittered = cap / 2 + Math.random() * (cap / 2);
  return Math.min(Math.max(jittered, retryAfterMs ?? 0), RETRY_MAX_DELAY_MS);
};

const isAbort = (error: unknown): boolean =>
  (error instanceof Error && error.name === "AbortError") ||
  (typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError");

/**
 * תיאור שאפשר לפעול לפיו. שגיאות fetch ב-Node עוטפות את הסיבה
 * האמיתית ב-`cause`, ובלעדיה ההודעה היא תמיד "fetch failed" — חסרת
 * ערך בדיוק ברגע שצריך אותה.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const cause = (error as { cause?: unknown }).cause;
  const causeText =
    cause instanceof Error
      ? ` (${cause.name}: ${cause.message})`
      : cause
        ? ` (${String(cause)})`
        : "";

  return `${error.name}: ${error.message}${causeText}`;
}

type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

// Retries non-2xx responses and network errors with exponential backoff, then
// returns the final Response so callers keep their existing error handling.
const fetchWithBackoff = async (
  url: string,
  init: FetchInit
): Promise<Response> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok || attempt === RETRY_MAX_RETRIES) {
        return response;
      }

      // 4xx (חוץ מ-429) הן שגיאות בקשה שלא ישתנו בניסיון חוזר
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return response;
      }

      const retryAfterMs = parseRetryAfter(
        response.headers.get("retry-after")
      );
      try {
        await response.body?.cancel();
      } catch {
        // Body already settled; nothing to clean up.
      }
      console.warn(
        `LLM request retry ${attempt + 1}/${RETRY_MAX_RETRIES} after status ${response.status}`
      );
      await sleep(computeBackoffDelay(attempt, retryAfterMs));
    } catch (error) {
      lastError = error;

      // ביטול הוא לא כשל רשת: הקורא סגר את החיבור או שפג הזמן, ואין
      // טעם לנסות שוב — ניסיון חוזר רק היה בולע את הסיבה האמיתית
      // מאחורי ארבעה סיבובים מיותרים.
      if (isAbort(error) || init.signal?.aborted) throw error;

      if (attempt === RETRY_MAX_RETRIES) throw error;

      // הסיבה עצמה, לא "network error" גנרי. בלעדיה אי אפשר להבחין
      // בין DNS, TLS, כותרת פסולה או יעד חסום — וזה בדיוק מה שצריך
      // לדעת כשמשהו נשבר בסביבה אחרת.
      console.warn(
        `LLM request retry ${attempt + 1}/${RETRY_MAX_RETRIES}: ${describeError(error)}`
      );
      await sleep(computeBackoffDelay(attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(
        `LLM request failed after exhausting retries: ${describeError(lastError)}`
      );
};

function buildAnthropicPayload(params: InvokeParams, stream: boolean) {
  const { system, turns } = splitSystemAndTurns(params.messages);
  const maxTokens = params.max_tokens ?? params.maxTokens;

  if (typeof maxTokens !== "number") {
    throw new Error("max_tokens is required");
  }

  const payload: Record<string, unknown> = {
    model: params.model,
    max_tokens: maxTokens,
    messages: turns,
    stream,
  };

  if (system) payload.system = system;

  // Anthropic Messages API doesn't take an OpenAI-style response_format /
  // json_schema parameter. Structured output here relies on prompting the
  // model to return JSON only (see MEMORY_EXTRACTION_PROMPT) plus lenient
  // parsing on the caller's side — good enough for this app's needs.

  return payload;
}

/** קריאה לא-סטרימינגית. משמש בעיקר לחילוץ הזיכרון. */
export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  assertApiKey();

  const response = await fetchWithBackoff(resolveApiUrl(), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(buildAnthropicPayload(params, false)),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `LLM invoke failed: ${response.status} ${response.statusText} – ${errorText}`
    );
  }

  const data = (await response.json()) as {
    id: string;
    model: string;
    content: Array<{ type: string; text?: string }>;
    stop_reason: string | null;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const text = (data.content || [])
    .filter(block => block.type === "text")
    .map(block => block.text || "")
    .join("");

  return {
    id: data.id,
    created: Math.floor(Date.now() / 1000),
    model: data.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: data.stop_reason,
      },
    ],
    usage: data.usage
      ? {
          prompt_tokens: data.usage.input_tokens,
          completion_tokens: data.usage.output_tokens,
          total_tokens: data.usage.input_tokens + data.usage.output_tokens,
        }
      : undefined,
  };
}

/**
 * גרסת סטרימינג. מחזירה Response שגוף ה-SSE שלו כבר מתורגם לצורת
 * "choices[0].delta.content" — בדיוק מה ש-chatRoute.ts כבר יודע
 * לפרסר — כדי ש-chatRoute.ts לא יצטרך לדעת על Anthropic בכלל.
 * שגיאה שמגיעה מ-Anthropic באמצע הזרימה מפילה את ה-stream (controller.error)
 * כדי שהיא תתפוס כראוי ב-catch של הקורא, במקום להיבלע בשקט.
 */
export async function streamLLM(
  params: InvokeParams & { signal?: AbortSignal }
): Promise<Response> {
  assertApiKey();

  const upstream = await fetchWithBackoff(resolveApiUrl(), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(buildAnthropicPayload(params, true)),
    signal: params.signal,
  });

  if (!upstream.ok) {
    const errorText = await upstream.text();
    throw new Error(
      `LLM stream failed: ${upstream.status} ${upstream.statusText} – ${errorText}`
    );
  }

  const upstreamReader = upstream.body?.getReader();
  if (!upstreamReader) {
    throw new Error("No response body from LLM");
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const transformed = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";

      const emitDelta = (text: string) => {
        const chunk = { choices: [{ delta: { content: text } }] };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      };

      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) return;
        const data = trimmed.slice(5).trim();
        if (!data) return;

        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(data);
        } catch {
          return;
        }

        if (
          evt.type === "content_block_delta" &&
          evt.delta &&
          typeof evt.delta === "object" &&
          (evt.delta as Record<string, unknown>).type === "text_delta"
        ) {
          const text = (evt.delta as Record<string, unknown>).text;
          if (typeof text === "string" && text.length > 0) {
            emitDelta(text);
          }
        } else if (evt.type === "error") {
          const errObj = evt.error as Record<string, unknown> | undefined;
          const message =
            (errObj && typeof errObj.message === "string" && errObj.message) ||
            "upstream stream error";
          throw new Error(String(message));
        }
      };

      try {
        while (true) {
          const { done, value } = await upstreamReader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) handleLine(line);
        }
        if (buffer.trim()) handleLine(buffer);
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      upstreamReader.cancel(reason).catch(() => {});
    },
  });

  return new Response(transformed, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}
