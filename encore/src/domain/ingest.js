// Attribution Engine + Commission Engine.
// הכניסה היחידה של כסף למערכת: אירוע חתום ממערכת הכרטוס. לחיצות לבדן לא מזכות בכלום (PRD §12).
import { insert, tx } from "../db.js";
import { clock, config, emailHash, feePerTicket, money, UserError } from "../util.js";
import { provider } from "../providers/index.js";
import { _setCancelHandler, getCampaignByExternal, promotedSold, setStatus } from "./campaigns.js";
import { audit, getUser, notify } from "./identity.js";

export class RetryLater extends UserError {
  constructor(msg) {
    super(msg, 409);
  }
}

/**
 * קליטת webhook. אידמפוטנטי בשלוש שכבות:
 *  1. מזהה האירוע נרשם ב-webhook_events — אירוע כפול לא מעובד שוב.
 *  2. הזמנה ייחודית לפי (ספק, מזהה הזמנה) — אותה רכישה לא נוצרת פעמיים גם באירוע אחר.
 *  3. החזרים נושאים סך מצטבר, והתגמול מחושב כ"יעד" ולא כ"הפרש" — חזרה על אותו מידע לא משנה כלום.
 * אם העיבוד נכשל, כל הטרנזקציה מתבטלת (כולל רישום האירוע) והספק ינסה שוב.
 */
export function ingestWebhook(db, providerName, raw, headers) {
  const p = provider(providerName);
  return ingestEvent(db, p.name, p.verifyWebhook(raw, headers));
}

/** אירוע שכבר אומת (או שנוצר בתוך המערכת, בקופה של JoCares). אותם כללי אידמפוטנטיות. */
export function ingestEvent(db, providerName, evt) {
  const p = provider(providerName);
  return tx(db, () => {
    const fresh = db
      .prepare("INSERT OR IGNORE INTO webhook_events (provider, event_id, type, received_at) VALUES (?, ?, ?, ?)")
      .run(p.name, evt.id, evt.type, clock.iso());
    if (fresh.changes === 0) return { status: "duplicate", eventId: evt.id };
    const handler = HANDLERS[evt.type];
    const result = handler ? handler(db, p.name, evt.data) : "ignored_type";
    db.prepare("UPDATE webhook_events SET result = ? WHERE provider = ? AND event_id = ?").run(String(result), p.name, evt.id);
    return { status: "processed", eventId: evt.id, result };
  });
}

const HANDLERS = {
  "order.paid": handleOrderPaid,
  "order.refunded": handleOrderRefunded,
  "event.cancelled": handleEventCancelled,
};

// ---------- שיוך ----------

/**
 * Last Eligible Click: הלחיצה האחרונה של הרוכש (נשמרת אצלו בעוגייה ועוברת לספק ב-ref)
 * מזכה רק אם כל התנאים מתקיימים. מחזיר סיבה קריאה לכל החלטה — לשקיפות ולטיפול במחלוקות.
 */
export function decideAttribution(db, campaign, { ref, buyerHash, qty, orderedAt }) {
  if (!ref) return { reason: "direct" };
  const click = db.prepare("SELECT * FROM referral_clicks WHERE token = ?").get(String(ref));
  if (!click) return { reason: "unknown_ref" };
  const link = db.prepare("SELECT * FROM referral_links WHERE id = ?").get(click.link_id);
  const base = { click };
  if (link.campaign_id !== campaign.id) return { ...base, reason: "wrong_campaign" };
  const ageDays = (new Date(orderedAt).getTime() - new Date(click.created_at).getTime()) / 86400000;
  if (ageDays > config.attributionDays || ageDays < -1) return { ...base, reason: "click_expired" };
  if (campaign.status !== "active") return { ...base, reason: `campaign_${campaign.status}` };
  const promoter = getUser(db, link.promoter_id);
  if (promoter.frozen_at) return { ...base, reason: "promoter_frozen" };
  if (promoter.email_hash === buyerHash) return { ...base, reason: "self_purchase" };
  const left = campaign.promo_limit ? campaign.promo_limit - promotedSold(db, campaign.id) : Infinity;
  if (left <= 0) return { ...base, reason: "promo_limit" };
  return { ...base, link, promoter, reason: "ok", rewardedQty: Math.min(qty, left) };
}

export const ATTRIBUTION_LABEL = {
  ok: "שויך למקדם",
  direct: "רכישה ישירה, בלי לינק",
  unknown_ref: "מזהה הפניה לא מוכר",
  wrong_campaign: "הלינק שייך להופעה אחרת",
  click_expired: `עברו יותר מ-${config.attributionDays} יום מהלחיצה`,
  campaign_paused: "הקמפיין היה מושהה",
  campaign_draft: "הקמפיין לא פורסם",
  campaign_sold_out: "מכסת הקידום הסתיימה",
  campaign_ended: "הקמפיין הסתיים",
  campaign_cancelled: "הקמפיין בוטל",
  promoter_frozen: "חשבון המקדם מוקפא",
  self_purchase: "רכישה עצמית של המקדם",
  promo_limit: "מכסת הקידום הסתיימה",
};

function handleOrderPaid(db, prov, d) {
  for (const k of ["order_id", "event_id", "qty", "unit_price_agorot", "buyer_email"]) {
    if (d[k] === undefined || d[k] === null || d[k] === "") throw new UserError(`bad order payload: ${k}`);
  }
  const campaign = getCampaignByExternal(db, prov, d.event_id);
  if (!campaign) return "unknown_event";
  if (db.prepare("SELECT 1 FROM orders WHERE provider = ? AND external_order_id = ?").get(prov, d.order_id)) {
    return "duplicate_order";
  }
  const qty = Number(d.qty);
  const unit = Number(d.unit_price_agorot);
  if (!Number.isInteger(qty) || qty < 1 || !Number.isInteger(unit) || unit < 0) throw new UserError("bad order payload");
  const buyerHash = emailHash(d.buyer_email);
  const orderedAt = d.ordered_at || clock.iso();
  const att = decideAttribution(db, campaign, { ref: d.ref, buyerHash, qty, orderedAt });

  const firstForArtist = !db
    .prepare("SELECT 1 FROM orders o JOIN campaigns c ON c.id = o.campaign_id WHERE c.artist_id = ? AND o.buyer_email_hash = ?")
    .get(campaign.artist_id, buyerHash);
  const rewarded = att.reason === "ok" ? att.rewardedQty : 0;
  // הנחה שהג׳וקר נתן לחבר יורדת מהתגמול שלו (לא מהאמן)
  const discount = att.reason === "ok" ? Math.max(0, Math.min(Number(d.joker_discount_agorot) || 0, campaign.reward_agorot - 100)) : 0;

  const orderId = insert(db, "orders", {
    provider: prov, external_order_id: String(d.order_id), campaign_id: campaign.id, qty, unit_price_agorot: unit,
    total_agorot: qty * unit, buyer_email_hash: buyerHash, first_for_artist: firstForArtist ? 1 : 0,
    click_id: att.click?.id ?? null, link_id: att.link?.id ?? null, terms_id: campaign.terms_id,
    rewarded_qty: rewarded, fee_agorot: rewarded * feePerTicket(unit, campaign.fee_bps),
    attribution: att.reason, ordered_at: orderedAt, created_at: clock.iso(), joker_discount_agorot: discount,
  });

  if (att.reason === "ok") {
    const amount = rewarded * (campaign.reward_agorot - discount);
    const cid = insert(db, "commissions", {
      kind: "sale", order_id: orderId, campaign_id: campaign.id, promoter_id: att.promoter.id,
      amount_agorot: amount, status: "pending", created_at: clock.iso(), updated_at: clock.iso(),
    });
    insert(db, "ledger", {
      commission_id: cid, user_id: att.promoter.id, type: "accrue", amount_agorot: amount,
      memo: `${rewarded} × ${money(campaign.reward_agorot - discount)}${discount ? ` (אחרי הנחה של ${money(discount)} לחבר)` : ""} · תנאים v${campaign.terms_version}`, created_at: clock.iso(),
    });
    if (att.promoter.notify_sales) {
      const who = qty > 1 ? `מישהו רכש ${rewarded} כרטיסים` : "מישהו רכש כרטיס";
      notify(db, att.promoter.id, `${who} ל"${campaign.title}" בזכותך. הרווחת ${money(amount)}, בכפוף לאישור העסקה.`, "/me/money", { email: true });
    }
    if (campaign.promo_limit && promotedSold(db, campaign.id) >= campaign.promo_limit) {
      setStatus(db, null, campaign.id, "sold_out", { reason: "promo_limit_reached" });
    }
  }
  return `order:${orderId}:${att.reason}`;
}

function handleOrderRefunded(db, prov, d) {
  if (!d.order_id || !Number.isInteger(Number(d.refunded_qty))) throw new UserError("bad refund payload");
  const order = db.prepare("SELECT * FROM orders WHERE provider = ? AND external_order_id = ?").get(prov, String(d.order_id));
  // החזר שהגיע לפני אישור הרכישה: מבקשים מהספק לנסות שוב מאוחר יותר
  if (!order) throw new RetryLater("refund for unknown order");
  const refunded = Math.min(order.qty, Math.max(order.refunded_qty, Number(d.refunded_qty) || 0));
  db.prepare("UPDATE orders SET refunded_qty = ? WHERE id = ?").run(refunded, order.id);
  reconcileOrder(db, order.id, null, "החזר מהספק");
  return `refund:${order.id}:${refunded}`;
}

function handleEventCancelled(db, prov, d) {
  if (!d.event_id) throw new UserError("bad cancel payload");
  const c = getCampaignByExternal(db, prov, d.event_id);
  if (!c) return "unknown_event";
  if (c.status === "cancelled") return "already_cancelled";
  if (c.status === "ended") {
    db.prepare("UPDATE campaigns SET status = 'cancelled', updated_at = ? WHERE id = ?").run(clock.iso(), c.id);
    audit(db, null, "campaign.status", "campaign", c.id, { from: "ended", to: "cancelled", reason: "provider_cancelled" });
    cancelOrders(db, c, null);
  } else {
    setStatus(db, null, c.id, "cancelled", { reason: "provider_cancelled" });
  }
  return `cancelled:${c.id}`;
}

function cancelOrders(db, campaign, actorId) {
  const ids = db.prepare("SELECT id FROM orders WHERE campaign_id = ? AND cancelled = 0").all(campaign.id);
  for (const { id } of ids) {
    db.prepare("UPDATE orders SET cancelled = 1 WHERE id = ?").run(id);
    reconcileOrder(db, id, actorId, "ההופעה בוטלה");
  }
}
_setCancelHandler(cancelOrders);

// ---------- מנוע התגמולים ----------

/**
 * מביא את התגמול של הזמנה לסכום הנכון לפי מצבה הנוכחי (החזרים, ביטול).
 * אם התגמול עוד לא שולם, מעדכנים אותו ישירות. אם כבר שולם או נמצא בתהליך תשלום, לא נוגעים בו:
 * יוצרים "קיזוז" (clawback) שיורד מהיתרה הבאה. כל שינוי נרשם ביומן.
 * כאשר הרוכש החזיר חלק מהכרטיסים, קודם יורדים כרטיסים שלא זיכו בתגמול.
 */
export function reconcileOrder(db, orderId, actorId, memo) {
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
  const terms = db.prepare("SELECT * FROM campaign_terms WHERE id = ?").get(order.terms_id);
  const remaining = order.cancelled ? 0 : Math.min(order.rewarded_qty, order.qty - order.refunded_qty);
  db.prepare("UPDATE orders SET fee_agorot = ? WHERE id = ?").run(remaining * feePerTicket(order.unit_price_agorot, terms.fee_bps), order.id);

  const sale = db.prepare("SELECT * FROM commissions WHERE order_id = ? AND kind = 'sale'").get(order.id);
  if (!sale) return;
  const target = remaining * (terms.reward_agorot - order.joker_discount_agorot);
  const now = clock.iso();

  if (sale.status === "paid" || sale.payout_id) {
    const clawed = db.prepare("SELECT COALESCE(SUM(amount_agorot), 0) n FROM commissions WHERE order_id = ? AND kind = 'clawback'").get(order.id).n;
    const delta = target - (sale.amount_agorot + clawed);
    if (delta >= 0) return;
    const cid = insert(db, "commissions", {
      kind: "clawback", order_id: order.id, campaign_id: order.campaign_id, promoter_id: sale.promoter_id,
      amount_agorot: delta, status: "payable", note: memo, created_at: now, updated_at: now, payable_at: now,
    });
    insert(db, "ledger", { commission_id: cid, user_id: sale.promoter_id, type: "clawback", amount_agorot: delta, memo, actor_id: actorId, created_at: now });
    notify(db, sale.promoter_id, `${memo}: ${money(-delta)} יקוזזו מהתשלום הבא שלך.`, "/me/money");
  } else {
    const delta = target - sale.amount_agorot;
    if (delta === 0) return;
    const status = target === 0 ? "reversed" : sale.status;
    db.prepare("UPDATE commissions SET amount_agorot = ?, status = ?, updated_at = ? WHERE id = ?").run(target, status, now, sale.id);
    insert(db, "ledger", { commission_id: sale.id, user_id: sale.promoter_id, type: "reverse", amount_agorot: delta, memo, actor_id: actorId, created_at: now });
    if (delta < 0) notify(db, sale.promoter_id, `${memo}: התגמול ירד ב-${money(-delta)}.`, "/me/money");
  }
}
