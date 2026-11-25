// חיבור לשרת של JoCares. האפליקציה מזדהה עם המפתח האישי של איש הצוות, שמגיע בקישור מהמארגן.
export type Session = { base: string; key: string };

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** מקבל את הקישור שהמארגן שלח (https://.../door/s/<מפתח>) ומחזיר שרת ומפתח */
export function parseJoin(input: string): Session | null {
  const s = String(input ?? "").trim();
  // קישור עמוק לאפליקציה: jocares-door://join?u=<הקישור המקורי>
  const deep = /^jocares-door:\/\/join\?u=(.+)$/i.exec(s);
  if (deep) return parseJoin(decodeURIComponent(deep[1]));
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  const local = /^(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)$/.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  const m = /^\/door\/s\/([A-Za-z0-9_-]{10,80})\/?/.exec(url.pathname);
  if (!m) return null;
  return { base: url.origin, key: m[1] };
}

export async function call<T>(s: Session, path: string, body?: unknown, timeoutMs = 6000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${s.base}/door/app/v1${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${s.key}`, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || "שגיאה בשרת", res.status);
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- מה שהשרת מחזיר ----------

export type Stats = { total: number; inside: number; last15: number };
export type EventSummary = { id: number; artist: string; title: string; venue: string; starts_at: string; inside: number; total: number };
export type Home = { staff: { name: string }; organizer: { name: string; kind: string }; events: EventSummary[] };
export type TicketView = { id: number; name: string; named: boolean; q: string; used_at?: string | null };
export type Result = "ok" | "used" | "refunded" | "unknown" | "wrong_show" | "undone";
export type CheckReply = { result: Result; ticket?: TicketView; stats: Stats };
export type ManifestTicket = { h: string; id: number; s: "valid" | "used" | "refunded"; q: string; n: string; named: boolean };
export type Manifest = { campaign: number; at: string; tickets: ManifestTicket[]; stats: Stats };
export type SearchRow = TicketView & { status: string; buyer: string };
