// מסלול הקופונים, מאחורי הקלעים. האמן והג׳וקר לא עושים כלום; צוות JoCares:
//  1. מגדיר במערכת הכרטוס של האמן את הקודים החדשים (רשימה + "סומנו כמוגדרים")
//  2. מעלה את ייצוא המכירות (CSV), רואה תצוגה מקדימה, ומאשר
// המכירות עוברות דרך אותו מנוע שיוך ותגמולים כמו webhooks: בלי כפילויות, החזרים מתעדכנים,
// והזכאות נבדקת לפי מצב הקמפיין ביום הקנייה (לא ביום ההעלאה).
import { insert, tx } from "../db.js";
import { clock, emailHash, feePerTicket, israelLocalToIso, money, shekelsToAgorot, UserError } from "../util.js";
import { audit, getUser, notify } from "./identity.js";
import { getCampaign, promotedSold } from "./campaigns.js";
import { reconcileOrder } from "./ingest.js";

// ---------- CSV ----------

/** מפענח CSV (RFC 4180): מרכאות, פסיקים ושורות בתוך תא, BOM, ומזהה מפריד: פסיק, נקודה-פסיק או טאב */
export function parseCsv(text) {
  const src = String(text ?? "").replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length]);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") q = true; // מרכאה פותחת רק בתחילת תא (סה"כ באמצע תא היא טקסט)
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const clean = rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ""));
  if (clean.length < 2) throw new UserError("הקובץ ריק או בלי שורות מכירה");
  return { header: clean[0], rows: clean.slice(1) };
}

const GUESS = {
  order: /הזמנה|מס[׳'].?הזמנה|order|transaction|עסקה|מזהה|^id$/i,
  coupon: /קופון|קוד|coupon|promo|voucher|discount.?code/i,
  qty: /כמות|כרטיסים|qty|quantity|tickets|count/i,
  amount: /סכום|סה.?כ|מחיר|total|amount|price|paid/i,
  date: /תאריך|זמן|date|time|created/i,
  email: /מייל|דוא.?ל|e-?mail/i,
  status: /סטטוס|מצב|status|state/i,
};

/** ניחוש אוטומטי של העמודות לפי שמות הכותרות. הצוות יכול לתקן במסך. */
export function guessMapping(header) {
  const map = {};
  for (const [field, re] of Object.entries(GUESS)) {
    const idx = header.findIndex((h, i) => re.test(h) && !Object.values(map).includes(i));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

const REFUND_RE = /החזר|בוטל|ביטול|refund|cancel|void|chargeback/i;

function parseDate(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  // 31/12/2026 21:00 או 31.12.2026 (פורמט ישראלי: יום קודם)
  const il = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (il) {
    const pad = (n) => String(n).padStart(2, "0");
    // תאריך בלי שעה = סוף אותו יום (לטובת הג׳וקר: מכירה ביום הפרסום עדיין נחשבת)
    return israelLocalToIso(`${il[3]}-${pad(il[2])}-${pad(il[1])}T${pad(il[4] ?? 23)}:${pad(il[5] ?? 59)}`);
  }
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (dateOnly) return israelLocalToIso(`${s}T23:59`);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** הופך שורות קובץ לרשומות מכירה אחידות לפי המיפוי */
export function normalizeRows({ header, rows }, mapping, campaign) {
  const at = (r, f) => (mapping[f] === undefined || mapping[f] === "" ? "" : r[Number(mapping[f])] ?? "");
  const out = [];
  const errors = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const orderId = at(r, "order");
    if (!orderId) return errors.push(`שורה ${line}: חסר מספר הזמנה`);
    const qty = mapping.qty === undefined || mapping.qty === "" ? 1 : parseInt(String(at(r, "qty")).replace(/[^\d-]/g, ""), 10);
    if (!Number.isInteger(qty) || qty === 0) return errors.push(`שורה ${line}: כמות לא תקינה`);
    const total = shekelsToAgorot(String(at(r, "amount")).replace(/[^\d.]/g, ""));
    const unit = total && qty > 0 ? Math.round(total / qty) : campaign.price_agorot;
    const refunded = REFUND_RE.test(at(r, "status")) || qty < 0;
    out.push({
      line,
      orderId: String(orderId),
      coupon: String(at(r, "coupon")).trim().toUpperCase().replace(/\s+/g, ""),
      qty: Math.abs(qty),
      unit,
      orderedAt: parseDate(at(r, "date")),
      email: String(at(r, "email")).trim().toLowerCase(),
      refunded,
    });
  });
  // אותה הזמנה יכולה להופיע כמה פעמים (שורה לכל כרטיס, או שורת החזר נפרדת): מאחדים
  const byOrder = new Map();
  for (const s of out) {
    const prev = byOrder.get(s.orderId);
    if (!prev) byOrder.set(s.orderId, { ...s, refundedQty: s.refunded ? s.qty : 0, qty: s.refunded ? 0 : s.qty });
    else {
      if (s.refunded) prev.refundedQty += s.qty;
      else prev.qty += s.qty;
      prev.coupon ||= s.coupon;
      prev.email ||= s.email;
      prev.orderedAt ||= s.orderedAt;
    }
  }
  const merged = [...byOrder.values()].map((s) => ({ ...s, qty: Math.max(s.qty, s.refundedQty), refundedQty: Math.min(s.refundedQty, Math.max(s.qty, s.refundedQty)) }));
  return { sales: merged, errors };
}

// ---------- מצב הקמפיין בתאריך נתון (מתוך יומן הפעולות) ----------

export function statusAt(db, campaign, iso) {
  if (!iso) return campaign.status;
  if (iso < campaign.created_at) return "draft";
  const row = db
    .prepare(
      `SELECT data FROM audit_log WHERE entity = 'campaign' AND entity_id = ? AND action = 'campaign.status' AND created_at <= ?
        ORDER BY id DESC LIMIT 1`
    )
    .get(campaign.id, iso);
  return row ? JSON.parse(row.data).to : "draft";
}

// ---------- שיוך מכירה בודדת ----------

function decideCouponAttribution(db, campaign, sale) {
  if (!sale.coupon) return { reason: "direct" };
  const link = db.prepare("SELECT * FROM referral_links WHERE coupon_code = ?").get(sale.coupon);
  if (!link) return { reason: "unknown_ref" };
  if (link.campaign_id !== campaign.id) return { reason: "wrong_campaign", link };
  const status = statusAt(db, campaign, sale.orderedAt);
  if (status !== "active") return { reason: `campaign_${status}`, link };
  const promoter = getUser(db, link.promoter_id);
  if (promoter.frozen_at) return { reason: "promoter_frozen", link };
  if (sale.email && promoter.email_hash === emailHash(sale.email)) return { reason: "self_purchase", link };
  const left = campaign.promo_limit ? campaign.promo_limit - promotedSold(db, campaign.id) : Infinity;
  if (left <= 0) return { reason: "promo_limit", link };
  return { reason: "ok", link, promoter, rewardedQty: Math.min(sale.qty, left) };
}

/** מחזיר מה יקרה לכל מכירה בלי לשנות כלום (לתצוגה המקדימה) */
export function classify(db, campaign, sale) {
  const extId = `${campaign.id}:${sale.orderId}`;
  const existing = db.prepare("SELECT * FROM orders WHERE provider = 'coupon' AND external_order_id = ?").get(extId);
  if (existing) {
    return { action: sale.refundedQty > existing.refunded_qty ? "refund" : "unchanged", existing };
  }
  return { action: "new", attribution: decideCouponAttribution(db, campaign, sale) };
}

function applySale(db, campaign, sale) {
  const extId = `${campaign.id}:${sale.orderId}`;
  const existing = db.prepare("SELECT * FROM orders WHERE provider = 'coupon' AND external_order_id = ?").get(extId);
  if (existing) {
    const refunded = Math.min(existing.qty, Math.max(existing.refunded_qty, sale.refundedQty));
    if (refunded !== existing.refunded_qty) {
      db.prepare("UPDATE orders SET refunded_qty = ? WHERE id = ?").run(refunded, existing.id);
      reconcileOrder(db, existing.id, null, "החזר לפי ייצוא המכירות");
      return "refund";
    }
    return "unchanged";
  }
  if (sale.qty < 1) return "skipped";
  const att = decideCouponAttribution(db, campaign, sale);
  const buyerHash = sale.email ? emailHash(sale.email) : emailHash(`order:${extId}`);
  const firstForArtist = sale.email
    ? !db.prepare("SELECT 1 FROM orders o JOIN campaigns c ON c.id = o.campaign_id WHERE c.artist_id = ? AND o.buyer_email_hash = ?").get(campaign.artist_id, buyerHash)
    : false;
  const rewarded = att.reason === "ok" ? att.rewardedQty : 0;
  const orderedAt = sale.orderedAt ?? clock.iso();
  const terms = db
    .prepare("SELECT * FROM campaign_terms WHERE campaign_id = ? AND created_at <= ? ORDER BY version DESC LIMIT 1")
    .get(campaign.id, orderedAt) ?? db.prepare("SELECT * FROM campaign_terms WHERE campaign_id = ? ORDER BY version LIMIT 1").get(campaign.id);
  const orderId = insert(db, "orders", {
    provider: "coupon", external_order_id: extId, campaign_id: campaign.id, qty: sale.qty,
    refunded_qty: Math.min(sale.refundedQty, sale.qty), unit_price_agorot: sale.unit, total_agorot: sale.qty * sale.unit,
    buyer_email_hash: buyerHash, first_for_artist: firstForArtist ? 1 : 0, click_id: null,
    link_id: att.reason === "ok" ? att.link.id : null, terms_id: terms.id, rewarded_qty: rewarded,
    fee_agorot: rewarded * feePerTicket(sale.unit, terms.fee_bps), attribution: att.reason, ordered_at: orderedAt, created_at: clock.iso(),
  });
  if (att.reason === "ok") {
    const amount = rewarded * terms.reward_agorot;
    const cid = insert(db, "commissions", {
      kind: "sale", order_id: orderId, campaign_id: campaign.id, promoter_id: att.promoter.id,
      amount_agorot: amount, status: "pending", created_at: clock.iso(), updated_at: clock.iso(),
    });
    insert(db, "ledger", {
      commission_id: cid, user_id: att.promoter.id, type: "accrue", amount_agorot: amount,
      memo: `קופון ${sale.coupon} · ${rewarded} × ${money(terms.reward_agorot)} · תנאים v${terms.version}`, created_at: clock.iso(),
    });
    if (sale.refundedQty) reconcileOrder(db, orderId, null, "החזר לפי ייצוא המכירות");
    if (att.promoter.notify_sales) {
      notify(db, att.promoter.id, `${rewarded > 1 ? `נמכרו ${rewarded} כרטיסים` : "נמכר כרטיס"} ל"${campaign.title}" עם הקוד שלך. הרווחת ${money(amount)}, בכפוף לאישור העסקה.`, "/me/money");
    }
  }
  return `new:${att.reason}`;
}

// ---------- ייבוא: תצוגה מקדימה ואישור ----------

export function previewImport(db, admin, campaignId, { csv, filename = "", mapping = null }) {
  const c = getCampaign(db, campaignId);
  if (!c || c.provider !== "coupon") throw new UserError("הקמפיין לא במסלול הקופונים");
  const parsed = parseCsv(csv);
  const map = mapping ?? guessMapping(parsed.header);
  const id = insert(db, "sales_imports", {
    campaign_id: c.id, filename: String(filename).slice(0, 200), raw_csv: String(csv), mapping: JSON.stringify(map),
    created_by: admin.id, created_at: clock.iso(),
  });
  return id;
}

export function describeImport(db, importId) {
  const imp = db.prepare("SELECT * FROM sales_imports WHERE id = ?").get(Number(importId));
  if (!imp) throw new UserError("הייבוא לא נמצא", 404);
  const c = getCampaign(db, imp.campaign_id);
  const parsed = parseCsv(imp.raw_csv);
  const mapping = JSON.parse(imp.mapping);
  const missing = ["order", "coupon"].filter((f) => mapping[f] === undefined || mapping[f] === "");
  if (missing.length) return { imp, c, parsed, mapping, missing, sales: [], errors: [], counts: {} };
  const { sales, errors } = normalizeRows(parsed, mapping, c);
  const rows = sales.map((s) => ({ ...s, ...classify(db, c, s) }));
  const counts = {
    total: rows.length,
    newMatched: rows.filter((r) => r.action === "new" && r.attribution.reason === "ok").length,
    newOther: rows.filter((r) => r.action === "new" && r.attribution.reason !== "ok").length,
    refunds: rows.filter((r) => r.action === "refund").length,
    unchanged: rows.filter((r) => r.action === "unchanged").length,
    unknownCodes: [...new Set(rows.filter((r) => r.action === "new" && r.attribution.reason === "unknown_ref").map((r) => r.coupon))],
  };
  return { imp, c, parsed, mapping, missing, sales: rows, errors, counts };
}

export function remapImport(db, importId, mapping) {
  const clean = {};
  for (const f of Object.keys(GUESS)) if (mapping[f] !== undefined && mapping[f] !== "") clean[f] = Number(mapping[f]);
  db.prepare("UPDATE sales_imports SET mapping = ? WHERE id = ? AND status = 'preview'").run(JSON.stringify(clean), Number(importId));
}

export function applyImport(db, admin, importId) {
  return tx(db, () => {
    const d = describeImport(db, importId);
    if (d.imp.status !== "preview") throw new UserError("הייבוא הזה כבר טופל");
    if (d.missing.length) throw new UserError("צריך לבחור עמודה למספר הזמנה ולקוד");
    const results = {};
    for (const s of d.sales) {
      const r = applySale(db, d.c, s);
      results[r] = (results[r] ?? 0) + 1;
    }
    db.prepare("UPDATE sales_imports SET status = 'applied', applied_at = ?, summary = ? WHERE id = ?").run(clock.iso(), JSON.stringify(results), d.imp.id);
    audit(db, admin.id, "sales_import.applied", "campaign", d.c.id, { import_id: d.imp.id, ...results });
    return results;
  });
}

export const lastImportAt = (db, campaignId) =>
  db.prepare("SELECT MAX(applied_at) t FROM sales_imports WHERE campaign_id = ? AND status = 'applied'").get(campaignId).t;

// ---------- הגדרת קודים אצל ספק הכרטוס ----------

export function couponQueue(db) {
  return db
    .prepare(
      `SELECT c.id AS campaign_id, e.title, COALESCE(NULLIF(e.performer, ''), a.name) AS artist_name, e.source_url, e.starts_at, c.status,
              (SELECT COUNT(*) FROM referral_links l WHERE l.campaign_id = c.id) AS codes,
              (SELECT COUNT(*) FROM referral_links l WHERE l.campaign_id = c.id AND l.coupon_registered_at IS NULL) AS pending,
              (SELECT MAX(applied_at) FROM sales_imports s WHERE s.campaign_id = c.id AND s.status = 'applied') AS last_import
         FROM campaigns c JOIN events e ON e.id = c.event_id JOIN artists a ON a.id = c.artist_id
        WHERE c.provider = 'coupon' AND c.status != 'draft'
        ORDER BY pending DESC, e.starts_at`
    )
    .all();
}

export const campaignCodes = (db, campaignId) =>
  db
    .prepare(
      `SELECT l.id, l.coupon_code, l.coupon_registered_at, l.created_at, u.name FROM referral_links l JOIN users u ON u.id = l.promoter_id
        WHERE l.campaign_id = ? ORDER BY l.coupon_registered_at IS NOT NULL, l.id`
    )
    .all(campaignId);

export function markRegistered(db, admin, campaignId, linkIds = null) {
  const now = clock.iso();
  const sql = linkIds?.length
    ? `UPDATE referral_links SET coupon_registered_at = ? WHERE campaign_id = ? AND coupon_registered_at IS NULL AND id IN (${linkIds.map(() => "?").join(",")})`
    : "UPDATE referral_links SET coupon_registered_at = ? WHERE campaign_id = ? AND coupon_registered_at IS NULL";
  const n = db.prepare(sql).run(now, Number(campaignId), ...(linkIds ?? []).map(Number)).changes;
  audit(db, admin.id, "coupons.registered", "campaign", Number(campaignId), { count: n });
  return n;
}

