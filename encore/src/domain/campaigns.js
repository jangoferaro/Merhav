// Artist & Event Management + Campaign Engine + Marketplace.
import { insert, tx } from "../db.js";
import { clock, config, feePerTicket, israelLocalToIso, shekelsToAgorot, text, UserError } from "../util.js";
import { audit, notify } from "./identity.js";
import { provider } from "../providers/index.js";
import { validImageRef } from "../media.js";

// ---------- מחזור החיים של קמפיין ----------

export const STATUS_LABEL = {
  draft: "טיוטה", active: "פעיל", paused: "מושהה", sold_out: "אזל", ended: "הסתיים", cancelled: "בוטל",
};

/** מעברים חוקיים בלבד. ended/cancelled הם סופיים. */
export const TRANSITIONS = {
  draft: ["active", "cancelled"],
  active: ["paused", "sold_out", "ended", "cancelled"],
  paused: ["active", "ended", "cancelled"],
  sold_out: ["active", "ended", "cancelled"],
  ended: [],
  cancelled: [],
};

export const canTransition = (from, to) => TRANSITIONS[from]?.includes(to) ?? false;

/** חלוקת מחיר הכרטיס — מוצג לאמן לפני פרסום ובכל שינוי תגמול */
export function split(priceAgorot, rewardAgorot, bps = config.feeBps) {
  const fee = feePerTicket(priceAgorot, bps);
  return { price: priceAgorot, reward: rewardAgorot, fee, artist: priceAgorot - rewardAgorot - fee };
}

/** המלצת תגמול מבוססת חוקים (גרסה ראשונה, בלי ML): ~20% מהמחיר, מעוגל ל-5 ₪, בין 5 ל-50 ₪ */
export function suggestReward(priceAgorot) {
  const raw = (priceAgorot * 0.2) / 100;
  const rounded = Math.max(5, Math.min(50, Math.round(raw / 5) * 5));
  return Math.min(rounded * 100, Math.max(100, priceAgorot - feePerTicket(priceAgorot, config.feeBps)));
}

function validateReward(priceAgorot, rewardAgorot) {
  if (!Number.isInteger(rewardAgorot) || rewardAgorot < 100) throw new UserError("התגמול למקדם צריך להיות לפחות ₪1");
  const s = split(priceAgorot, rewardAgorot);
  if (s.artist < 0) throw new UserError("התגמול גבוה מדי: לא נשאר לך כלום מהכרטיס");
}

function parseLimit(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 100000) throw new UserError("מגבלת כרטיסים לא תקינה");
  return n;
}

// ---------- יצירה ----------

/** מאמת ומנרמל את טופס יצירת הקמפיין (משמש גם לתצוגה המקדימה) */
export function parseCampaignInput(input) {
  const price = shekelsToAgorot(input.price);
  if (!price) throw new UserError("מחיר הכרטיס לא תקין");
  const reward = shekelsToAgorot(input.reward);
  if (reward === null) throw new UserError("התגמול למקדם לא תקין");
  validateReward(price, reward);
  const startsAt = israelLocalToIso(input.starts_at);
  if (!startsAt) throw new UserError("חסר תאריך ושעה");
  if (startsAt <= clock.iso()) throw new UserError("ההופעה כבר עברה");
  // אין הופעה בלי תמונה: קובץ שהועלה (‎/media/…) או תמונה מעמוד ההופעה (https)
  const image = validImageRef(input.image_url);
  if (!image) throw new UserError("צריך תמונה להופעה. אפשר להעלות מהטלפון או מהמחשב.");
  const source = String(input.source_url ?? "").trim();
  if (source && !/^https?:\/\/\S+$/.test(source)) throw new UserError("הלינק להופעה לא תקין");
  return {
    artist_name: text(input.artist_name, "שם האמן"),
    title: text(input.title, "שם ההופעה"),
    venue: text(input.venue, "מקום"),
    city: text(input.city, "עיר", { max: 40, required: false }),
    genre: text(input.genre, "סגנון", { max: 40, required: false }),
    description: text(input.description, "תיאור", { max: 2000, required: false }),
    starts_at: startsAt,
    image_url: image,
    source_url: source.slice(0, 500),
    price_agorot: price,
    reward_agorot: reward,
    promo_limit: parseLimit(input.promo_limit),
    share_text: text(input.share_text, "טקסט לשיתוף", { max: 600, required: false }),
    // "coupon" = האמן מוכר במערכת הכרטוס שלו (ברירת מחדל כשיש לינק להופעה); "sim" = קופה לדוגמה
    ticketing: (() => {
      if (input.ticketing === "sim") return "sim";
      if (input.ticketing === "coupon" && !source) throw new UserError("צריך לינק לעמוד הכרטיסים שלך, כדי שנדע לאן לשלוח את הקונים");
      return source ? "coupon" : "sim";
    })(),
  };
}

export function createCampaign(db, user, input, { publish = true } = {}) {
  const c = parseCampaignInput(input);
  return tx(db, () => {
    const now = clock.iso();
    // אמן: משתמשים באמן קיים של המשתמש עם אותו שם, אחרת יוצרים
    let artist = db
      .prepare("SELECT a.* FROM artists a JOIN artist_members m ON m.artist_id = a.id WHERE m.user_id = ? AND a.name = ?")
      .get(user.id, c.artist_name);
    if (!artist) {
      const id = insert(db, "artists", { name: c.artist_name, created_at: now });
      insert(db, "artist_members", { artist_id: id, user_id: user.id, role: "owner" });
      artist = { id, name: c.artist_name };
    }
    const eventId = insert(db, "events", {
      artist_id: artist.id, title: c.title, description: c.description, venue: c.venue, city: c.city,
      genre: c.genre, starts_at: c.starts_at, image_url: c.image_url, source_url: c.source_url, created_at: now,
    });
    const p = provider(c.ticketing);
    const externalId = p.registerEvent(db, { title: c.title, price_agorot: c.price_agorot });
    const campaignId = insert(db, "campaigns", {
      event_id: eventId, artist_id: artist.id, created_by: user.id, status: "draft",
      price_agorot: c.price_agorot, promo_limit: c.promo_limit, provider: p.name, external_event_id: externalId,
      share_text: c.share_text, created_at: now, updated_at: now,
    });
    insert(db, "campaign_terms", {
      campaign_id: campaignId, version: 1, reward_agorot: c.reward_agorot, fee_bps: config.feeBps,
      created_by: user.id, created_at: now,
    });
    audit(db, user.id, "campaign.created", "campaign", campaignId, { reward: c.reward_agorot, price: c.price_agorot });
    if (publish) setStatus(db, user, campaignId, "active");
    return campaignId;
  });
}

// ---------- שאילתות ----------

const CAMPAIGN_SELECT = `
  SELECT c.*, e.title, e.description, e.venue, e.city, e.genre, e.starts_at, e.image_url, e.source_url,
         a.name AS artist_name,
         t.id AS terms_id, t.version AS terms_version, t.reward_agorot, t.fee_bps
    FROM campaigns c
    JOIN events e ON e.id = c.event_id
    JOIN artists a ON a.id = c.artist_id
    JOIN campaign_terms t ON t.campaign_id = c.id
     AND t.version = (SELECT MAX(version) FROM campaign_terms WHERE campaign_id = c.id)`;

export const getCampaign = (db, id) => db.prepare(`${CAMPAIGN_SELECT} WHERE c.id = ?`).get(Number(id));
export const getCampaignByExternal = (db, prov, extId) =>
  db.prepare(`${CAMPAIGN_SELECT} WHERE c.provider = ? AND c.external_event_id = ?`).get(prov, extId);

export function campaignsOfUser(db, userId) {
  return db
    .prepare(`${CAMPAIGN_SELECT} JOIN artist_members m ON m.artist_id = c.artist_id WHERE m.user_id = ? ORDER BY e.starts_at`)
    .all(userId);
}

/** כרטיסים שכבר קיבלו תגמול בקמפיין (לבדיקת מגבלת הקידום) */
export function promotedSold(db, campaignId) {
  return db
    .prepare("SELECT COALESCE(SUM(MIN(rewarded_qty, qty - refunded_qty)), 0) n FROM orders WHERE campaign_id = ? AND cancelled = 0")
    .get(campaignId).n;
}

// ---------- שינויים ----------

export function setStatus(db, user, campaignId, to, { reason = "" } = {}) {
  return tx(db, () => {
    const c = getCampaign(db, campaignId);
    if (!c) throw new UserError("קמפיין לא נמצא", 404);
    if (c.status === to) return c;
    if (!canTransition(c.status, to)) {
      throw new UserError(`אי אפשר לעבור מ"${STATUS_LABEL[c.status]}" ל"${STATUS_LABEL[to]}"`);
    }
    if (to === "active" && c.starts_at <= clock.iso()) throw new UserError("ההופעה כבר התחילה");
    if (to === "active" && c.promo_limit && promotedSold(db, c.id) >= c.promo_limit) {
      throw new UserError("הגעת למגבלת הכרטיסים לקידום. הגדילו אותה כדי להפעיל מחדש.");
    }
    db.prepare("UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?").run(to, clock.iso(), c.id);
    audit(db, user?.id, "campaign.status", "campaign", c.id, { from: c.status, to, reason });

    if (to === "cancelled") cancelCampaignOrders(db, c, user?.id);
    if (["paused", "ended", "cancelled", "sold_out"].includes(to)) {
      const msg = {
        paused: `הקידום של "${c.title}" הושהה. מכירות חדשות לא יזכו בתגמול עד שיחודש.`,
        ended: `הקידום של "${c.title}" הסתיים. כל מה שכבר הרווחת נשמר.`,
        cancelled: `ההופעה "${c.title}" בוטלה. תגמולים על כרטיסים שהוחזרו מתבטלים.`,
        sold_out: `"${c.title}" אזל לקידום. כל מה שכבר הרווחת נשמר.`,
      }[to];
      for (const { promoter_id } of db.prepare("SELECT promoter_id FROM referral_links WHERE campaign_id = ?").all(c.id)) {
        notify(db, promoter_id, msg, "/me/sales");
      }
    }
    return getCampaign(db, c.id);
  });
}

// מוגדר ב-ingest.js; מוזרק כאן כדי למנוע תלות מעגלית
let cancelCampaignOrders = () => {};
export const _setCancelHandler = (fn) => (cancelCampaignOrders = fn);

/** שינוי תגמול: יוצר גרסת תנאים חדשה שחלה רק על מכירות עתידיות */
export function changeReward(db, user, campaignId, rewardInput) {
  return tx(db, () => {
    const c = getCampaign(db, campaignId);
    if (["ended", "cancelled"].includes(c.status)) throw new UserError("הקמפיין סגור");
    const reward = shekelsToAgorot(rewardInput);
    if (reward === null) throw new UserError("התגמול לא תקין");
    validateReward(c.price_agorot, reward);
    if (reward === c.reward_agorot) return c;
    insert(db, "campaign_terms", {
      campaign_id: c.id, version: c.terms_version + 1, reward_agorot: reward, fee_bps: config.feeBps,
      created_by: user.id, created_at: clock.iso(),
    });
    audit(db, user.id, "campaign.terms", "campaign", c.id, { from: c.reward_agorot, to: reward });
    const up = reward > c.reward_agorot;
    for (const { promoter_id } of db.prepare("SELECT promoter_id FROM referral_links WHERE campaign_id = ?").all(c.id)) {
      notify(db, promoter_id, `התגמול על "${c.title}" ${up ? "עלה" : "השתנה"} ל-₪${reward / 100} לכרטיס, למכירות מעכשיו.`, `/s/${c.id}`);
    }
    return getCampaign(db, c.id);
  });
}

export function updateCampaignDetails(db, user, campaignId, input) {
  return tx(db, () => {
    const c = getCampaign(db, campaignId);
    const limit = parseLimit(input.promo_limit);
    if (limit !== null && limit < promotedSold(db, c.id)) throw new UserError("המגבלה נמוכה ממה שכבר נמכר");
    const share = text(input.share_text, "טקסט לשיתוף", { max: 600, required: false });
    const image = validImageRef(input.image_url);
    if (!image) throw new UserError("צריך תמונה להופעה");
    db.prepare("UPDATE campaigns SET promo_limit = ?, share_text = ?, updated_at = ? WHERE id = ?").run(limit, share, clock.iso(), c.id);
    db.prepare("UPDATE events SET image_url = ?, description = ? WHERE id = ?").run(
      image, text(input.description, "תיאור", { max: 2000, required: false }), c.event_id
    );
    audit(db, user.id, "campaign.updated", "campaign", c.id, { promo_limit: limit });
    return getCampaign(db, c.id);
  });
}

// ---------- מרקטפלייס ----------

/**
 * דירוג מבוסס חוקים (PRD §17 — בלי ML בגרסה הראשונה):
 * תגמול יחסי למחיר, דחיפות (הופעה בעוד 2–21 יום), מלאי פנוי לקידום, והתאמה אישית
 * לפי ערים וסגנונות שהמקדם כבר קידם בעבר. לא משתמשים באנשי קשר.
 */
export function marketplace(db, { userId = null, city = "", when = "" } = {}) {
  const now = clock.now().getTime();
  let rows = db.prepare(`${CAMPAIGN_SELECT} WHERE c.status = 'active' AND e.starts_at > ?`).all(clock.iso());

  if (city) rows = rows.filter((r) => r.city === city);
  if (when === "week") rows = rows.filter((r) => new Date(r.starts_at).getTime() - now < 7 * 86400000);
  if (when === "month") rows = rows.filter((r) => new Date(r.starts_at).getTime() - now < 31 * 86400000);

  const history = userId
    ? db
        .prepare(
          `SELECT e.city, e.genre FROM referral_links l JOIN campaigns c ON c.id = l.campaign_id
             JOIN events e ON e.id = c.event_id WHERE l.promoter_id = ?`
        )
        .all(userId)
    : [];
  const cities = new Set(history.map((h) => h.city).filter(Boolean));
  const genres = new Set(history.map((h) => h.genre).filter(Boolean));
  const mine = new Set(userId ? db.prepare("SELECT campaign_id FROM referral_links WHERE promoter_id = ?").all(userId).map((r) => r.campaign_id) : []);

  for (const r of rows) {
    const days = (new Date(r.starts_at).getTime() - now) / 86400000;
    const rewardRatio = Math.min(r.reward_agorot / r.price_agorot, 0.5) / 0.5; // 0..1
    const urgency = days < 1 ? 0.3 : days <= 21 ? 1 : Math.max(0.2, 1 - (days - 21) / 60);
    const left = r.promo_limit ? 1 - promotedSold(db, r.id) / r.promo_limit : 1;
    r.promo_left = r.promo_limit ? r.promo_limit - promotedSold(db, r.id) : null;
    r.score = rewardRatio * 40 + urgency * 30 + left * 10 + (cities.has(r.city) ? 15 : 0) + (genres.has(r.genre) ? 5 : 0);
    r.promoting = mine.has(r.id);
  }
  return rows.sort((a, b) => b.score - a.score);
}

export function marketplaceCities(db) {
  return db
    .prepare(`SELECT DISTINCT e.city FROM campaigns c JOIN events e ON e.id = c.event_id WHERE c.status = 'active' AND e.city != '' AND e.starts_at > ? ORDER BY e.city`)
    .all(clock.iso())
    .map((r) => r.city);
}

// ---------- תוצאות לאמן ----------

export function campaignResults(db, campaignId) {
  const o = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN link_id IS NOT NULL AND cancelled = 0 THEN qty - refunded_qty END), 0) AS tickets,
              COALESCE(SUM(CASE WHEN link_id IS NOT NULL AND cancelled = 0 THEN (qty - refunded_qty) * unit_price_agorot END), 0) AS revenue,
              COUNT(DISTINCT CASE WHEN link_id IS NOT NULL AND first_for_artist = 1 AND cancelled = 0 THEN buyer_email_hash END) AS first_time,
              COALESCE(SUM(CASE WHEN cancelled = 0 THEN qty - refunded_qty END), 0) AS all_tickets
         FROM orders WHERE campaign_id = ?`
    )
    .get(campaignId);
  const promoters = db.prepare("SELECT COUNT(*) n FROM referral_links WHERE campaign_id = ?").get(campaignId).n;
  const clicks = db
    .prepare("SELECT COUNT(*) n FROM referral_clicks k JOIN referral_links l ON l.id = k.link_id WHERE l.campaign_id = ?")
    .get(campaignId).n;
  const money = db
    .prepare(
      `SELECT COALESCE(SUM(amount_agorot), 0) rewards FROM commissions
        WHERE campaign_id = ? AND status != 'reversed'`
    )
    .get(campaignId);
  const fees = db
    .prepare("SELECT COALESCE(SUM(fee_agorot), 0) n FROM orders WHERE campaign_id = ? AND cancelled = 0")
    .get(campaignId).n;
  return { ...o, promoters, clicks, rewards: money.rewards, fees };
}

/** המקדמים המובילים — שם פרטי בלבד, בלי פרטי קשר (פרטיות כברירת מחדל) */
export function topPromoters(db, campaignId, limit = 10) {
  return db
    .prepare(
      `SELECT u.name, l.id AS link_id,
              (SELECT COUNT(*) FROM referral_clicks k WHERE k.link_id = l.id) AS clicks,
              COALESCE((SELECT SUM(MIN(o.rewarded_qty, o.qty - o.refunded_qty)) FROM orders o WHERE o.link_id = l.id AND o.cancelled = 0), 0) AS tickets
         FROM referral_links l JOIN users u ON u.id = l.promoter_id
        WHERE l.campaign_id = ?
        ORDER BY tickets DESC, clicks DESC LIMIT ?`
    )
    .all(campaignId, limit);
}

export function artistOverview(db, userId) {
  const list = campaignsOfUser(db, userId);
  const totals = { tickets: 0, revenue: 0, promoters: 0, first_time: 0, active: 0 };
  for (const c of list) {
    c.results = campaignResults(db, c.id);
    totals.tickets += c.results.tickets;
    totals.revenue += c.results.revenue;
    totals.promoters += c.results.promoters;
    totals.first_time += c.results.first_time;
    if (c.status === "active") totals.active++;
  }
  return { list, totals };
}
