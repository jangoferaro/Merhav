// חילוץ פרטי הופעה מלינק (PRD §8.1). קורא JSON-LD של schema.org (Event / MusicEvent)
// שרוב אתרי הכרטוס מפרסמים עבור גוגל, ואם אין, תגיות Open Graph.
// מחזיר רק את מה שנמצא. את השאר האמן ממלא, ושום פרט לא "מנוחש".
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";
import { isoToIsraelLocal } from "../util.js";

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;

// ---------- הגנת SSRF: לא מאפשרים לשרת לפנות לכתובות פנימיות ----------

export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19))
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

/** lookup שנבדק ברגע החיבור עצמו — חוסם גם DNS rebinding */
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: options.family }];
    if (!list.length || list.some((a) => isPrivateIp(a.address))) return cb(new Error("blocked address"));
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

function fetchHtml(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error("bad url"));
    }
    if (!["http:", "https:"].includes(u.protocol)) return reject(new Error("bad protocol"));
    if (net.isIP(u.hostname) && isPrivateIp(u.hostname)) return reject(new Error("blocked address"));
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.get(
      u,
      { lookup: safeLookup, timeout: TIMEOUT_MS, headers: { "user-agent": "Mozilla/5.0 (compatible; EncoreBot/0.2)", accept: "text/html" } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirects >= MAX_REDIRECTS) return reject(new Error("too many redirects"));
          return resolve(fetchHtml(new URL(res.headers.location, u).toString(), redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`status ${res.statusCode}`));
        }
        let size = 0;
        const chunks = [];
        res.on("data", (c) => {
          size += c.length;
          if (size > MAX_BYTES) return req.destroy(new Error("too large"));
          chunks.push(c);
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

// ---------- פענוח ----------

const decodeEntities = (s) =>
  String(s ?? "")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, "&").trim();

function meta(html, prop) {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  return tag ? decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1]) : "";
}

function findEvent(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const f = findEvent(n);
      if (f) return f;
    }
    return null;
  }
  const types = [].concat(node["@type"] ?? []);
  if (types.some((t) => /Event$/.test(String(t)))) return node;
  return findEvent(node["@graph"]);
}

const first = (v) => (Array.isArray(v) ? v[0] : v);
const name = (v) => (typeof first(v) === "string" ? first(v) : first(v)?.name) ?? "";

export function parseShowHtml(html) {
  const out = {};
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const ev = findEvent(data);
    if (!ev) continue;
    out.title = decodeEntities(ev.name);
    out.description = decodeEntities(ev.description).slice(0, 2000);
    out.artist_name = decodeEntities(name(ev.performer) || name(ev.organizer));
    if (ev.startDate && !Number.isNaN(Date.parse(ev.startDate))) {
      // תאריך בלי אזור זמן מתפרש כשעון ישראל
      out.starts_at = /[zZ]|[+-]\d\d:?\d\d$/.test(ev.startDate)
        ? isoToIsraelLocal(new Date(ev.startDate).toISOString())
        : String(ev.startDate).slice(0, 16);
    }
    const loc = first(ev.location);
    out.venue = decodeEntities(typeof loc === "string" ? loc : loc?.name);
    const addr = loc?.address;
    out.city = decodeEntities(typeof addr === "string" ? "" : addr?.addressLocality);
    const offer = first(ev.offers);
    const price = offer?.price ?? offer?.lowPrice;
    if (price !== undefined && !Number.isNaN(Number(price)) && Number(price) > 0) out.price = String(Number(price));
    const img = first(ev.image);
    out.image_url = typeof img === "string" ? img : img?.url ?? "";
    break;
  }
  out.title ||= meta(html, "og:title") || decodeEntities(html.match(/<title>([^<]*)<\/title>/i)?.[1]);
  out.description ||= meta(html, "og:description") || meta(html, "description");
  out.image_url ||= meta(html, "og:image");
  if (out.image_url && !out.image_url.startsWith("https://")) out.image_url = "";
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v));
}

/** לא זורק לעולם: במקרה של כשל מחזיר אובייקט ריק, והאמן פשוט ממלא ידנית */
export async function extractShow(url) {
  try {
    return { ...parseShowHtml(await fetchHtml(url)), source_url: url };
  } catch (e) {
    return { source_url: url, error: e.message };
  }
}
