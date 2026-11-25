// חיבור חשבונות חיצוניים של ג׳וקר: התחלה (OAuth), חזרה, סנכרון, חידוש, ניתוק.
// עקרונות: הרשאות מינימליות, אסימונים מוצפנים בצד השרת בלבד, כשל ספק לא חוסם שום דבר אחר,
// ניתוק מוחק את האסימונים ואת הנתונים שסונכרנו, וכל מדד נשמר עם מקור ומועד.
import crypto from "node:crypto";
import { insert, tx } from "../db.js";
import { clock, decrypt, encrypt, hmac, randomToken, safeEqual, UserError } from "../util.js";
import { audit } from "./identity.js";
import { PROVIDERS, configured, mapGenres, providerOr404 } from "../connect/providers.js";

const STATE_TTL_MS = 10 * 60 * 1000;
const SYNC_EVERY_MS = 24 * 3600 * 1000;
const MAX_FAILS = 5;

const seal = (obj) => {
  const body = Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${body}.${hmac(body, "connect-state")}`;
};
const open = (v) => {
  const [body, sig] = String(v ?? "").split(".");
  if (!body || !sig || !safeEqual(sig, hmac(body, "connect-state"))) return null;
  try {
    const o = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return o.exp > clock.now().getTime() ? o : null;
  } catch {
    return null;
  }
};

export const accountsOf = (db, userId) => db.prepare("SELECT * FROM connected_accounts WHERE user_id = ?").all(userId);
export const accountOf = (db, userId, provider) => db.prepare("SELECT * FROM connected_accounts WHERE user_id = ? AND provider = ?").get(userId, provider);

/** שלב 1: לאן להפנות את הדפדפן, ועוגייה חתומה עם state ו-PKCE */
export function startConnect(user, name, { redirectUri }) {
  const p = providerOr404(name);
  if (p.clientSide) throw new UserError("החיבור הזה נעשה מהדף שלו");
  if (!configured(p)) throw new UserError(`החיבור ל-${p.label} עוד לא הוגדר`);
  const state = randomToken(18);
  const verifier = p.pkce ? randomToken(48) : null;
  const params = {
    [p.clientParam ?? "client_id"]: p.clientId(), redirect_uri: redirectUri, response_type: "code",
    scope: p.scopes.join(p.scopeSep ?? " "), state, ...(p.extraAuth ?? {}),
  };
  if (verifier) Object.assign(params, { code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" });
  const url = new URL(p.authUrl);
  url.search = new URLSearchParams(params).toString();
  return { url: url.toString(), cookieValue: seal({ state, verifier, provider: name, uid: user.id, exp: clock.now().getTime() + STATE_TTL_MS }) };
}

async function exchangeCode(p, { code, verifier, redirectUri }, f) {
  const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  if (verifier) body.set("code_verifier", verifier);
  const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (p.tokenAuth === "basic") headers.authorization = "Basic " + Buffer.from(`${p.clientId()}:${p.clientSecret()}`).toString("base64");
  else {
    body.set(p.clientParam ?? "client_id", p.clientId());
    body.set("client_secret", p.clientSecret());
  }
  const res = await f(p.tokenUrl, { method: "POST", headers, body });
  const t = await res.json().catch(() => ({}));
  if (!res.ok || !t.access_token) throw new UserError(`${p.label} לא אישר את החיבור. נסו שוב.`);
  return p.afterToken ? { ...t, ...(await p.afterToken(t, f)) } : t;
}

function storeTokens(db, userId, name, t, scopes) {
  const now = clock.iso();
  const expires = t.expires_in ? new Date(clock.now().getTime() + Number(t.expires_in) * 1000).toISOString() : null;
  const prev = accountOf(db, userId, name);
  const tokens = encrypt({ access: t.access_token, refresh: t.refresh_token ?? (prev ? decrypt(prev.tokens_enc)?.refresh : null) ?? null });
  if (prev) {
    db.prepare("UPDATE connected_accounts SET status = 'connected', tokens_enc = ?, expires_at = ?, scopes = ?, last_error = NULL, fail_count = 0, updated_at = ? WHERE id = ?")
      .run(tokens, expires, scopes, now, prev.id);
  } else {
    insert(db, "connected_accounts", {
      user_id: userId, provider: name, status: "connected", tokens_enc: tokens, expires_at: expires, scopes,
      consented_at: now, created_at: now, updated_at: now,
    });
  }
  return accountOf(db, userId, name);
}

/** שלב 2: חזרה מהספק. מחליף קוד באסימון, שומר מוצפן, ומסנכרן מיד */
export async function finishConnect(db, user, name, { query, cookieValue, redirectUri, fetchImpl = fetch }) {
  const p = providerOr404(name);
  const st = open(cookieValue);
  if (!st || st.provider !== name || st.uid !== user.id || !safeEqual(String(query.state ?? ""), st.state)) {
    throw new UserError("החיבור לא הושלם. נסו שוב.");
  }
  if (query.error) throw new UserError(query.error === "access_denied" ? "החיבור בוטל. אפשר לנסות שוב מתי שרוצים." : `${p.label} החזיר שגיאה. נסו שוב.`);
  const t = await exchangeCode(p, { code: String(query.code ?? ""), verifier: st.verifier, redirectUri }, fetchImpl);
  const acc = storeTokens(db, user.id, name, t, String(t.scope ?? p.scopes.join(" ")));
  audit(db, user.id, "connect.connected", "user", user.id, { provider: name });
  return syncAccount(db, acc, fetchImpl);
}

/** Apple: ה-Music User Token מגיע מהדפדפן (MusicKit JS) */
export async function connectApple(db, user, musicUserToken, fetchImpl = fetch) {
  const p = PROVIDERS.apple;
  if (!configured(p)) throw new UserError("Apple Music עוד לא הוגדר");
  const tok = String(musicUserToken ?? "").trim();
  if (tok.length < 20 || tok.length > 4000) throw new UserError("Apple Music לא אישר את החיבור. נסו שוב.");
  const acc = storeTokens(db, user.id, "apple", { access_token: tok, expires_in: 180 * 86400 }, "library");
  audit(db, user.id, "connect.connected", "user", user.id, { provider: "apple" });
  return syncAccount(db, acc, fetchImpl);
}

async function freshToken(db, acc, f) {
  const p = PROVIDERS[acc.provider];
  const tok = decrypt(acc.tokens_enc) ?? {};
  const soon = acc.expires_at && new Date(acc.expires_at).getTime() - clock.now().getTime() < 3600_000;
  if (!soon) return tok.access;
  if (p.refresh) {
    const r = await p.refresh({ ...acc, ...tok }, f);
    storeTokens(db, acc.user_id, acc.provider, r, acc.scopes);
    return r.access_token;
  }
  if (tok.refresh && p.tokenUrl) {
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: tok.refresh });
    const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    if (p.tokenAuth === "basic") headers.authorization = "Basic " + Buffer.from(`${p.clientId()}:${p.clientSecret()}`).toString("base64");
    else { body.set(p.clientParam ?? "client_id", p.clientId()); body.set("client_secret", p.clientSecret()); }
    const res = await f(p.tokenUrl, { method: "POST", headers, body });
    const t = await res.json().catch(() => ({}));
    if (!res.ok || !t.access_token) { const e = new Error("refresh failed"); e.unauthorized = true; throw e; }
    storeTokens(db, acc.user_id, acc.provider, t, acc.scopes);
    return t.access_token;
  }
  const e = new Error("token expired");
  e.unauthorized = true;
  throw e;
}

/** סנכרון אחד. כשל לא זורק החוצה: הוא נרשם בחשבון, והמשתמש רואה מה קרה ויכול לנסות שוב */
export async function syncAccount(db, acc, fetchImpl = fetch) {
  const p = PROVIDERS[acc.provider];
  try {
    const token = await freshToken(db, acc, fetchImpl);
    const r = await p.fetch(token, fetchImpl);
    const now = clock.iso();
    tx(db, () => {
      db.prepare("UPDATE connected_accounts SET status = 'connected', external_id = ?, handle = ?, profile_url = ?, last_sync_at = ?, last_error = NULL, fail_count = 0, note = ?, updated_at = ? WHERE id = ?")
        .run(r.externalId ?? null, String(r.handle ?? "").slice(0, 100), String(r.url ?? "").slice(0, 300), now, r.empty ?? null, now, acc.id);
      for (const [metric, value] of Object.entries(r.metrics ?? {})) {
        if (Number.isFinite(Number(value)) && value !== null) insert(db, "metric_snapshots", { user_id: acc.user_id, provider: acc.provider, metric, value: Math.round(Number(value)), measured_at: now });
      }
      if (p.kind === "music") {
        db.prepare("DELETE FROM music_signals WHERE user_id = ? AND provider = ?").run(acc.user_id, acc.provider);
        [...new Set(r.artists ?? [])].slice(0, 30).forEach((name, i) => insert(db, "music_signals", { user_id: acc.user_id, provider: acc.provider, kind: "artist", name: String(name).slice(0, 80), rank: i, synced_at: now }));
        mapGenres(r.genres ?? []).forEach((name, i) => insert(db, "music_signals", { user_id: acc.user_id, provider: acc.provider, kind: "genre", name, rank: i, synced_at: now }));
      }
    });
    return { ok: true, account: accountOf(db, acc.user_id, acc.provider) };
  } catch (e) {
    const status = e.unauthorized ? "expired" : "error";
    db.prepare("UPDATE connected_accounts SET status = ?, last_error = ?, fail_count = fail_count + 1, updated_at = ? WHERE id = ?")
      .run(status, String(e.message).slice(0, 300), clock.iso(), acc.id);
    return { ok: false, status, account: accountOf(db, acc.user_id, acc.provider) };
  }
}

/** סנכרון יומי ברקע. אחרי 5 כשלונות ברצף מפסיקים לנסות, עד שהמשתמש לוחץ "נסו שוב" */
export async function syncDue(db, fetchImpl = fetch) {
  const before = new Date(clock.now().getTime() - SYNC_EVERY_MS).toISOString();
  const due = db.prepare("SELECT * FROM connected_accounts WHERE status != 'expired' AND fail_count < ? AND (last_sync_at IS NULL OR last_sync_at < ?) LIMIT 100").all(MAX_FAILS, before);
  let ok = 0;
  for (const acc of due) if ((await syncAccount(db, acc, fetchImpl)).ok) ok++;
  return ok;
}

/** ניתוק: האסימונים, המדדים והטעם שסונכרנו נמחקים. נשאר רק רישום ביומן שהיה חיבור */
export function disconnect(db, user, name) {
  providerOr404(name);
  tx(db, () => {
    db.prepare("DELETE FROM connected_accounts WHERE user_id = ? AND provider = ?").run(user.id, name);
    db.prepare("DELETE FROM metric_snapshots WHERE user_id = ? AND provider = ?").run(user.id, name);
    db.prepare("DELETE FROM music_signals WHERE user_id = ? AND provider = ?").run(user.id, name);
    audit(db, user.id, "connect.disconnected", "user", user.id, { provider: name });
  });
}

// ---------- מה הפרופיל משתמש בו ----------

/** המדד המאומת הכי חזק (עוקבים), עם מקור ומועד. null אם אין */
export function verifiedSocial(db, userId) {
  const rows = db
    .prepare(
      `SELECT s.provider, s.value, s.measured_at, a.handle, a.profile_url FROM metric_snapshots s
         JOIN connected_accounts a ON a.user_id = s.user_id AND a.provider = s.provider
        WHERE s.user_id = ? AND s.metric = 'followers'
          AND s.measured_at = (SELECT MAX(measured_at) FROM metric_snapshots x WHERE x.user_id = s.user_id AND x.provider = s.provider AND x.metric = 'followers')`
    )
    .all(userId);
  if (!rows.length) return null;
  const best = rows.reduce((a, b) => (b.value > a.value ? b : a));
  const label = PROVIDERS[best.provider].label;
  return { ...best, label, total: rows.reduce((s, r) => s + r.value, 0), all: rows.map((r) => ({ ...r, label: PROVIDERS[r.provider].label })) };
}

/** צמיחה רק משתי מדידות אמיתיות לפחות, בהפרש של שבוע ומעלה */
export function growth(db, userId, provider) {
  const rows = db.prepare("SELECT value, measured_at FROM metric_snapshots WHERE user_id = ? AND provider = ? AND metric = 'followers' ORDER BY measured_at").all(userId, provider);
  if (rows.length < 2) return null;
  const first = rows[0], last = rows[rows.length - 1];
  const days = (new Date(last.measured_at) - new Date(first.measured_at)) / 86400000;
  return days >= 7 ? { delta: last.value - first.value, days: Math.round(days) } : null;
}

export function musicFromConnections(db, userId) {
  const rows = db.prepare("SELECT * FROM music_signals WHERE user_id = ? ORDER BY rank").all(userId);
  const by = (kind) => [...new Set(rows.filter((r) => r.kind === kind).map((r) => r.name))];
  const sources = [...new Set(rows.map((r) => PROVIDERS[r.provider].label))];
  return { genres: by("genre"), artists: by("artist").slice(0, 12), sources };
}
