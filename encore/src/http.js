// שכבת HTTP דקה: ניתוב, עוגיות, טפסים, CSRF, הגבלת קצב והודעות flash.
import { config, hmac, randomToken, safeEqual, UserError } from "./util.js";

const MAX_BODY = 64 * 1024;

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {}
  }
  return out;
}

export function cookie(name, value, { maxAge, httpOnly = true } = {}) {
  return [
    `${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax",
    httpOnly && "HttpOnly", config.isProd && "Secure", maxAge !== undefined && `Max-Age=${maxAge}`,
  ].filter(Boolean).join("; ");
}

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new UserError("הבקשה גדולה מדי", 413));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ---------- הגבלת קצב (בזיכרון; בפריסה מרובת שרתים מחליפים ב-Redis) ----------

const buckets = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    if (buckets.size > 50_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return;
  }
  if (++b.n > max) throw new UserError("יותר מדי בקשות. נסו שוב בעוד רגע.", 429);
}
export const resetRateLimits = () => buckets.clear();

// ---------- נתב ----------

export class Router {
  routes = [];
  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "/?$");
    this.routes.push({ method, re, keys, handler, opts });
  }
  get(p, h, o) { this.add("GET", p, h, o); }
  post(p, h, o) { this.add("POST", p, h, o); }
  match(method, path) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const m = r.re.exec(path);
      if (m) return { ...r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  }
}

/** הקשר לבקשה אחת */
export function makeCtx(req, res) {
  const url = new URL(req.url, "http://local");
  const cookies = parseCookies(req.headers.cookie);
  const setCookies = [];
  let vid = cookies.vid;
  if (!vid || !/^[\w-]{16,64}$/.test(vid)) {
    vid = randomToken(16);
    setCookies.push(cookie("vid", vid, { maxAge: 365 * 86400 }));
  }
  const ctx = {
    req, res, url, cookies, vid, params: {}, query: Object.fromEntries(url.searchParams),
    ip: (config.isProd && String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim()) || req.socket.remoteAddress || "?",
    csrf: hmac(vid, "csrf"),
    user: null,
    flash: null,
    setCookie: (c) => setCookies.push(c),
    _form: null,
    async form() {
      if (!this._form) this._form = Object.fromEntries(new URLSearchParams(await readBody(req)));
      return this._form;
    },
    checkCsrf(form) {
      if (!cookies.vid || !safeEqual(String(form._csrf ?? ""), this.csrf)) {
        throw new UserError("פג תוקף הטופס. רעננו את הדף ונסו שוב.", 403);
      }
    },
    send(html, status = 200, headers = {}) {
      res.writeHead(status, {
        "content-type": "text/html; charset=utf-8",
        "set-cookie": setCookies,
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "strict-origin-when-cross-origin",
        "content-security-policy":
          "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; form-action 'self'; frame-ancestors 'none'",
        ...headers,
      });
      res.end(html);
    },
    redirect(to, flash) {
      if (flash) setCookies.push(cookie("flash", JSON.stringify(typeof flash === "string" ? { ok: true, m: flash } : flash), { maxAge: 60 }));
      // רק הפניות פנימיות — מונע open redirect
      const safe = typeof to === "string" && to.startsWith("/") && !to.startsWith("//") ? to : "/";
      res.writeHead(303, { location: safe, "set-cookie": setCookies });
      res.end();
    },
    json(obj, status = 200) {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    },
  };
  if (cookies.flash) {
    try {
      ctx.flash = JSON.parse(cookies.flash);
    } catch {}
    setCookies.push(cookie("flash", "", { maxAge: 0 }));
  }
  return ctx;
}

/** next=... רק לנתיב פנימי */
export const safeNext = (n) => (typeof n === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(n) ? n : "");
