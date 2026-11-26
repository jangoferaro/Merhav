// המנוע של הסורק: בדיקה מול השרת, ובלי קליטה בדיקה מול הרשימה השמורה ותור שנשלח כשהקליטה חוזרת.
// אותה לוגיקה כמו באפליקציית הדפדפן (encore/public/door-app.js), כדי ששתיהן יתנהגו אותו דבר.
import { useCallback, useEffect, useRef, useState } from "react";
import NetInfo from "@react-native-community/netinfo";
import { CryptoDigestAlgorithm, digestStringAsync } from "expo-crypto";
import { ApiError, call, type CheckReply, type Manifest, type ManifestTicket, type Result, type SearchRow, type Session, type Stats, type TicketView } from "./api";
import { deviceId, getJSON, setJSON } from "./storage";
import { feedback } from "./feedback";

export type Shown = {
  kind: Result | "queued" | "idle";
  good: boolean;
  /** ביטול כניסה: לא ירוק ולא אדום, כדי שלא ייראה כמו "להכניס" */
  neutral: boolean;
  title: string;
  name: string;
  detail: string;
  ticket?: TicketView;
  at: number;
};

const TITLES: Record<string, string> = {
  ok: "כניסה", queued: "כניסה", used: "כבר נכנס/ה", refunded: "כרטיס שהוחזר", unknown: "קוד לא מוכר",
  wrong_show: "הופעה אחרת", undone: "הכניסה בוטלה",
};
const DETAILS: Record<string, string> = {
  refunded: "הכסף הוחזר. הכרטיס לא בתוקף",
  unknown: "לא כרטיס של JoCares, או צילום פגום",
  wrong_show: "הכרטיס להופעה אחרת. הפנו לתור הנכון",
  undone: "הכרטיס שוב בתוקף, ואפשר לסרוק אותו מחדש",
  queued: "נשמר במכשיר ויישלח כשהחיבור יחזור",
};
const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : "");
export const UNDO_MS = 5 * 60_000;

export const normalize = (v: string) => String(v ?? "").toUpperCase().replace(/^JOT-/, "").replace(/[^A-Z0-9]/g, "").slice(0, 20);
const hash = async (code: string) => (await digestStringAsync(CryptoDigestAlgorithm.SHA256, normalize(code))).slice(0, 32);

type Queued = { id: number; at: string };

export function useDoor(session: Session, campaignId: number) {
  const key = `${campaignId}`;
  const [stats, setStats] = useState<Stats>({ total: 0, inside: 0, last15: 0 });
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncedAt, setSyncedAt] = useState<string>("");
  const [reachable, setReachable] = useState(true);
  const [shown, setShown] = useState<Shown>({ kind: "idle", good: true, neutral: true, title: "מוכנים לסריקה", name: "", detail: "מכוונים את המצלמה ל-QR שעל הכרטיס", at: 0 });
  const [rejected, setRejected] = useState(0);
  const [conflicts, setConflicts] = useState(0);

  const tickets = useRef(new Map<string, ManifestTicket>());
  const queue = useRef<Queued[]>([]);
  const device = useRef("");
  const busy = useRef(false);
  const onlineRef = useRef(true);
  // הרשת יכולה להיות מחוברת והשרת לא עונה (Wi-Fi של מקום בלי אינטרנט). אז עובדים כמו בלי קליטה
  const reachableRef = useRef(true);
  const markReachable = useCallback((v: boolean) => {
    reachableRef.current = v;
    setReachable(v);
  }, []);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const persist = useCallback(() => {
    setJSON(`${key}:manifest`, [...tickets.current.values()]);
    setJSON(`${key}:queue`, queue.current);
    setPending(queue.current.length);
  }, [key]);

  const show = useCallback((kind: Shown["kind"], ticket?: TicketView, detail = "") => {
    const neutral = kind === "undone";
    const good = kind === "ok" || kind === "queued" || neutral;
    let d = detail || DETAILS[kind] || "";
    if (!detail && (kind === "ok" || kind === "queued")) {
      const type = ticket?.named ? "כרטיס שמי: בדקו תעודה מזהה עם השם הזה" : "כרטיס רגיל";
      d = kind === "queued" ? `${type}. ${DETAILS.queued}` : type;
    }
    if (!detail && kind === "used" && ticket?.used_at) d = `נסרק ב-${time(ticket.used_at)}`;
    setShown({ kind, good, neutral, title: TITLES[kind] ?? kind, name: ticket ? `${ticket.name}${ticket.q ? ` · כרטיס ${ticket.q}` : ""}` : "", detail: d, ticket, at: Date.now() });
    if (!good) setRejected((n) => n + 1);
    feedback(good);
  }, []);

  const loadManifest = useCallback(async () => {
    try {
      const m = await call<Manifest>(session, `/e/${campaignId}/manifest`);
      tickets.current = new Map(m.tickets.map((t) => [t.h, t]));
      // כניסות שעוד בתור נשארות מסומנות, גם אם השרת עוד לא יודע עליהן
      for (const q of queue.current) for (const t of tickets.current.values()) if (t.id === q.id) t.s = "used";
      persist();
      setStats(m.stats);
      setSyncedAt(time(new Date().toISOString()));
      markReachable(true);
      return true;
    } catch (e) {
      if (!(e instanceof ApiError)) markReachable(false);
      return false;
    }
  }, [session, campaignId, persist, markReachable]);

  const flush = useCallback(async () => {
    if (!queue.current.length) return;
    const items = queue.current.slice();
    try {
      const r = await call<{ results: { id: number; result: string }[]; stats: Stats }>(session, `/e/${campaignId}/sync`, { items, device: device.current });
      queue.current = queue.current.filter((q) => !items.includes(q));
      persist();
      setStats(r.stats);
      markReachable(true);
      // הכניסה שמוצגת נשלחה: מעדכנים את השורה שאמרה שהיא תישלח
      setShown((s) => (s.kind === "queued" ? { ...s, detail: s.detail.replace(DETAILS.queued, "נשלח לשרת") } : s));
      const c = r.results.filter((x) => x.result === "conflict").length;
      if (c) {
        setConflicts((n) => n + c);
        show("used", undefined, `${c} כרטיסים שנסרקו בלי קליטה כבר נכנסו מדלת אחרת`);
      }
    } catch (e) {
      if (!(e instanceof ApiError)) markReachable(false);
    }
  }, [session, campaignId, persist, show, markReachable]);

  // טעינה ראשונה: קודם מה שנשמר במכשיר, ואז מהשרת
  useEffect(() => {
    let alive = true;
    (async () => {
      device.current = await deviceId();
      const saved = await getJSON<ManifestTicket[]>(`${key}:manifest`, []);
      queue.current = await getJSON<Queued[]>(`${key}:queue`, []);
      if (!alive) return;
      tickets.current = new Map(saved.map((t) => [t.h, t]));
      setPending(queue.current.length);
      await loadManifest();
      await flush();
    })();
    const unsub = NetInfo.addEventListener((s) => {
      const on = s.isConnected !== false && s.isInternetReachable !== false;
      onlineRef.current = on;
      setOnline(on);
      if (on) flush().then(loadManifest);
    });
    let ticks = 0;
    const timer = setInterval(() => {
      ticks++;
      // כשהשרת לא ענה בודקים כל 10 שניות, אחרת כל 30
      if (onlineRef.current && (!reachableRef.current || ticks % 3 === 0)) flush().then(loadManifest);
    }, 10_000);
    return () => {
      alive = false;
      unsub();
      clearInterval(timer);
    };
  }, [key, loadManifest, flush]);

  const admitLocal = useCallback(
    (t: ManifestTicket) => {
      const view = { id: t.id, name: t.n, q: t.q, named: t.named };
      if (t.s === "refunded") return show("refunded", view);
      if (t.s === "used") return show("used", view, "כבר נסרק (לפי הרשימה במכשיר)");
      t.s = "used";
      queue.current.push({ id: t.id, at: new Date().toISOString() });
      persist();
      setStats((s) => ({ ...s, inside: s.inside + 1 }));
      show("queued", view);
    },
    [persist, show]
  );

  const admitOffline = useCallback(
    async (code: string) => {
      const t = tickets.current.get(await hash(code));
      if (!t) return show("unknown", undefined, "בלי קליטה: הכרטיס לא ברשימה שנשמרה");
      admitLocal(t);
    },
    [admitLocal, show]
  );

  const reply = useCallback(
    (r: CheckReply) => {
      setStats(r.stats);
      if (r.result === "ok" && r.ticket) for (const t of tickets.current.values()) if (t.id === r.ticket.id) t.s = "used";
      show(r.result, r.ticket, r.result === "wrong_show" && r.other ? `הכרטיס ל: ${r.other}. הפנו לתור הנכון` : "");
    },
    [show]
  );

  /**
   * סריקה או הקלדה של קוד. הבדיקות רצות אחת אחרי השנייה ואף קוד לא נזרק,
   * כי סורק חיצוני (Bluetooth או USB) יכול לשלוח כמה קודים ברצף מהיר.
   */
  const check = useCallback(
    (raw: string) => {
      const code = String(raw ?? "").trim();
      if (!normalize(code)) return Promise.resolve();
      const run = async () => {
        busy.current = true;
        try {
          if (!onlineRef.current || !reachableRef.current) return await admitOffline(code);
          reply(await call<CheckReply>(session, `/e/${campaignId}/check`, { code, device: device.current }, 3500));
          markReachable(true);
        } catch (e) {
          if (e instanceof ApiError) show("unknown", undefined, e.message);
          else {
            markReachable(false);
            await admitOffline(code); // השרת לא ענה בזמן: ממשיכים לפי הרשימה
          }
        } finally {
          busy.current = false;
        }
      };
      const next = chain.current.then(run, run);
      chain.current = next;
      return next;
    },
    [session, campaignId, admitOffline, reply, show, markReachable]
  );

  /** הכנסה מתוך החיפוש */
  const admitById = useCallback(
    async (id: number) => {
      const local = [...tickets.current.values()].find((t) => t.id === id);
      if (!onlineRef.current || !reachableRef.current) return local ? admitLocal(local) : undefined;
      try {
        reply(await call<CheckReply>(session, `/e/${campaignId}/checkid`, { id, device: device.current }));
      } catch (e) {
        if (e instanceof ApiError) show("unknown", undefined, e.message);
        else if (local) admitLocal(local);
      }
    },
    [session, campaignId, admitLocal, reply, show]
  );

  const undo = useCallback(async () => {
    const id = shown.ticket?.id;
    if (!id) return;
    try {
      const r = await call<CheckReply>(session, `/e/${campaignId}/undo`, { id, device: device.current });
      for (const t of tickets.current.values()) if (t.id === id) t.s = "valid";
      persist();
      reply(r);
    } catch (e) {
      show("unknown", undefined, e instanceof ApiError ? e.message : "אין קליטה. אפשר לבטל כשהקליטה תחזור");
    }
  }, [session, campaignId, shown, persist, reply, show]);

  const search = useCallback(
    async (q: string): Promise<SearchRow[]> => {
      const s = q.trim();
      if (s.length < 2) return [];
      if (onlineRef.current && reachableRef.current) {
        try {
          return await call<SearchRow[]>(session, `/e/${campaignId}/search?q=${encodeURIComponent(s)}`);
        } catch {}
      }
      return [...tickets.current.values()]
        .filter((t) => t.s !== "refunded" && t.n.includes(s))
        .slice(0, 12)
        .map((t) => ({ id: t.id, name: t.n, named: t.named, q: t.q, status: t.s, buyer: "" }));
    },
    [session, campaignId]
  );

  const reset = useCallback(() => setShown((s) => ({ ...s, kind: "idle", good: true, neutral: true, title: "מוכנים לסריקה", name: "", detail: "מכוונים את המצלמה ל-QR שעל הכרטיס", ticket: undefined })), []);

  return { stats, online: online && reachable, pending, syncedAt, shown, rejected, conflicts, check, admitById, undo, search, reset, refresh: () => flush().then(loadManifest) };
}

export type Door = ReturnType<typeof useDoor>;
