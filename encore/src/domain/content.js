// מודול התוכן: פרופילי יוצרים, שירותים במחיר ידוע, הזמנות, תוצרים, זכויות ותשלום.
// משתמש באותן תשתיות של המוצר הראשי: משתמשים, התראות, Audit, יומן כספי ובקשות תשלום.
import { insert, tx } from "../db.js";
import { addDays, clock, config, feePerTicket, money, shekelsToAgorot, showDate, text, UserError } from "../util.js";
import { audit, getUser, notify, publicName } from "./identity.js";
import { getCampaign } from "./campaigns.js";
import { addAsset, getOrCreateLink } from "./referrals.js";
import { simPay } from "../providers/simpay.js";
import { ANY_MEDIA_RE, mediaKind, saveMedia, validImageRef } from "../media.js";

const payments = simPay;

// ---------- זכויות שימוש: שלושה מסלולים מוכנים במקום חוזה (PRD §19) ----------

export const LICENSES = {
  organic: {
    label: "שימוש בערוצים שלך",
    points: [
      "מותר לפרסם בערוצים של האמן (פוסטים, סטוריז, אתר)",
      "לא לפרסום ממומן",
      "מותר לקצר ולהוסיף כתוביות, לא לשנות את התוכן",
      "ל-12 חודשים",
      "כשההזמנה קשורה להופעה: הג׳וקרים של ההופעה רשאים לשתף את התוכן בערוצים שלהם, עם קרדיט ליוצר",
      "הזכויות נשארות של היוצר, והוא רשאי להציג את העבודה בתיק העבודות",
    ],
  },
  full: {
    label: "שימוש מלא כולל ממומן",
    points: [
      "מותר לפרסם בכל ערוץ, כולל פרסום ממומן",
      "מותר לערוך",
      "ללא הגבלת זמן",
      "כשההזמנה קשורה להופעה: הג׳וקרים של ההופעה רשאים לשתף את התוכן בערוצים שלהם, עם קרדיט ליוצר",
      "הזכויות נשארות של היוצר, והוא רשאי להציג את העבודה בתיק העבודות",
    ],
  },
  exposure: {
    label: "פרסום אצל היוצר",
    points: [
      "התוכן מתפרסם בערוץ של היוצר, עם גילוי נאות",
      "מותר לאמן לשתף את הפרסום המקורי",
      "שימוש נוסף בתוכן דורש הסכמה ותשלום נפרדים",
      "היוצר מתחייב להשאיר את הפרסום לפחות 30 יום",
    ],
  },
};

// ---------- תבניות שירות: היוצר רק בוחר ומתמחר (PRD §8.2) ----------

export const TEMPLATES = {
  recommend: { title: "סרטון המלצה", deliverable: "סרטון אנכי של 30–60 שניות, בקול שלך", days: 5, revisions: 1, license: "organic", pub: 0, kind: "content" },
  reel: { title: "ריל לקידום הופעה או שיר", deliverable: "ריל ערוך עד 45 שניות עם כתוביות", days: 5, revisions: 1, license: "organic", pub: 0, kind: "content" },
  song_review: { title: "סקירת שיר", deliverable: "סרטון או טקסט עם דעה כנה על השיר", days: 4, revisions: 0, license: "organic", pub: 0, kind: "content" },
  live_shoot: { title: "צילום בהופעה", deliverable: "10–20 תמונות ערוכות או 3 קליפים קצרים מההופעה", days: 4, revisions: 1, license: "full", pub: 0, kind: "content" },
  graphic: { title: "פוסטר או גרפיקה", deliverable: "פוסטר + גרסת סטורי, קבצים לשימוש", days: 4, revisions: 2, license: "full", pub: 0, kind: "content" },
  story_post: { title: "סטורי בערוץ שלי", deliverable: "סטורי אחד או יותר בערוץ שלך, עם קישור", days: 3, revisions: 0, license: "exposure", pub: 1, kind: "exposure" },
  feed_post: { title: "פוסט או ריל בערוץ שלי", deliverable: "פוסט או ריל קבוע בערוץ שלך", days: 5, revisions: 1, license: "exposure", pub: 1, kind: "exposure" },
  community: { title: "פרסום בקהילה או בערוץ שלי", deliverable: "הודעה בקבוצה, ערוץ טלגרם או ניוזלטר שלך", days: 3, revisions: 0, license: "exposure", pub: 1, kind: "exposure" },
};

export const KIND_LABEL = { content: "תוכן בשבילך", exposure: "פרסום לקהל של היוצר" };

export const ORDER_STATUS = {
  requested: "ממתין לאישור היוצר",
  accepted: "בעבודה",
  submitted: "התוצר מחכה לאישורך",
  revision_requested: "בתיקון",
  approved: "מחכה לפרסום",
  published: "פורסם, מחכה לאימות",
  completed: "הושלם",
  cancelled: "בוטל",
  disputed: "בבדיקת הצוות",
};

/** מעברים חוקיים. disputed חוזר רק דרך החלטת צוות. completed/cancelled סופיים. */
export const ORDER_TRANSITIONS = {
  requested: ["accepted", "cancelled"],
  accepted: ["submitted", "cancelled", "disputed"],
  submitted: ["revision_requested", "approved", "completed", "disputed"],
  revision_requested: ["submitted", "disputed"],
  approved: ["published", "disputed"],
  published: ["completed", "disputed"],
  disputed: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

const list = (v, max = 8) =>
  String(v ?? "").split(/[,،\n]/).map((s) => s.trim()).filter(Boolean).slice(0, max).map((s) => s.slice(0, 30));
const httpsUrl = (v, label) => {
  const s = String(v ?? "").trim();
  if (!/^https:\/\/[^\s<>"]+$/.test(s) || s.length > 500) throw new UserError(`${label}: צריך קישור שמתחיל ב-https://`);
  return s;
};

// ---------- פרופיל יוצר ----------

export const getProfile = (db, userId) => db.prepare("SELECT * FROM creator_profiles WHERE user_id = ?").get(userId);

export function saveProfile(db, user, input) {
  const now = clock.iso();
  const kinds = [].concat(input.kinds ?? []).filter((k) => k in KIND_LABEL);
  const row = {
    display_name: text(input.display_name || user.name, "שם", { max: 60 }),
    bio: text(input.bio, "כמה מילים עליך", { max: 600, required: false }),
    city: text(input.city, "עיר", { max: 40, required: false }),
    genres: list(input.genres).join(","),
    kinds: kinds.join(","),
    image_url: validImageRef(input.image_url) || (() => { throw new UserError("צריך תמונה שלך לפרופיל. אמנים רוצים לראות מי יוצר בשבילם."); })(),
  };
  if (getProfile(db, user.id)) {
    db.prepare(
      "UPDATE creator_profiles SET display_name=:display_name, bio=:bio, city=:city, genres=:genres, kinds=:kinds, image_url=:image_url, updated_at=:now WHERE user_id=:uid"
    ).run({ ...row, now, uid: user.id });
  } else {
    insert(db, "creator_profiles", { user_id: user.id, ...row, created_at: now, updated_at: now });
    audit(db, user.id, "creator.profile_created", "user", user.id);
  }
}

export function addPortfolio(db, user, { url, title }) {
  if (db.prepare("SELECT COUNT(*) n FROM creator_portfolio WHERE user_id = ?").get(user.id).n >= 8) throw new UserError("עד 8 עבודות");
  insert(db, "creator_portfolio", { user_id: user.id, url: httpsUrl(url, "קישור לעבודה"), title: text(title, "תיאור", { max: 80, required: false }), created_at: clock.iso() });
}

export function addChannel(db, user, { platform, url, followers }) {
  const f = String(followers ?? "").replace(/\D/g, "");
  insert(db, "social_channels", {
    user_id: user.id, platform: text(platform, "פלטפורמה", { max: 30 }), url: httpsUrl(url, "קישור לערוץ"),
    followers: f ? Math.min(Number(f), 100_000_000) : null, created_at: clock.iso(),
  });
}

export const removeOwned = (db, user, table, id) => {
  if (!["creator_portfolio", "social_channels"].includes(table)) throw new Error("bad table");
  db.prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`).run(Number(id), user.id);
};

export const portfolio = (db, userId) => db.prepare("SELECT * FROM creator_portfolio WHERE user_id = ? ORDER BY id").all(userId);
export const channels = (db, userId) => db.prepare("SELECT * FROM social_channels WHERE user_id = ? ORDER BY id").all(userId);

export function setProfileStatus(db, admin, userId, status) {
  db.prepare("UPDATE creator_profiles SET status = ?, updated_at = ? WHERE user_id = ?").run(status === "hidden" ? "hidden" : "active", clock.iso(), userId);
  audit(db, admin.id, `creator.${status}`, "user", userId);
}

// ---------- שירותים ----------

export function saveService(db, user, input, serviceId = null) {
  if (!getProfile(db, user.id)) throw new UserError("קודם פותחים פרופיל יוצר");
  const tpl = TEMPLATES[input.template] ? input.template : null;
  if (!tpl) throw new UserError("בחרו סוג שירות");
  const t = TEMPLATES[tpl];
  const price = shekelsToAgorot(input.price);
  if (!price || price < 1000 || price > 5_000_000) throw new UserError("מחיר בין ₪10 ל-₪50,000");
  const days = Number(input.delivery_days || t.days);
  if (!Number.isInteger(days) || days < 1 || days > 60) throw new UserError("זמן אספקה בין 1 ל-60 ימים");
  const revisions = Number(input.revisions ?? t.revisions);
  if (!Number.isInteger(revisions) || revisions < 0 || revisions > 3) throw new UserError("עד 3 סבבי תיקונים");
  const license = LICENSES[input.license] ? input.license : t.license;
  const row = {
    template: tpl, title: text(input.title || t.title, "שם השירות", { max: 80 }),
    deliverable: text(input.deliverable || t.deliverable, "מה האמן מקבל", { max: 300 }),
    description: text(input.description, "פירוט", { max: 1000, required: false }),
    price_agorot: price, delivery_days: days, revisions, license, includes_publication: t.pub,
  };
  const now = clock.iso();
  if (serviceId) {
    const s = db.prepare("SELECT * FROM creator_services WHERE id = ? AND user_id = ?").get(Number(serviceId), user.id);
    if (!s) throw new UserError("השירות לא נמצא", 404);
    db.prepare(
      `UPDATE creator_services SET template=:template, title=:title, deliverable=:deliverable, description=:description, price_agorot=:price_agorot,
         delivery_days=:delivery_days, revisions=:revisions, license=:license, includes_publication=:includes_publication, updated_at=:now WHERE id=:id`
    ).run({ ...row, now, id: s.id });
    return s.id;
  }
  const id = insert(db, "creator_services", { user_id: user.id, ...row, created_at: now, updated_at: now });
  audit(db, user.id, "service.created", "service", id, { price });
  return id;
}

export function setServiceActive(db, user, serviceId, active) {
  db.prepare("UPDATE creator_services SET active = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(active ? 1 : 0, clock.iso(), Number(serviceId), user.id);
}

export const getService = (db, id) => db.prepare("SELECT * FROM creator_services WHERE id = ?").get(Number(id));
export const servicesOf = (db, userId, { activeOnly = false } = {}) =>
  db.prepare(`SELECT * FROM creator_services WHERE user_id = ? ${activeOnly ? "AND active = 1" : ""} ORDER BY price_agorot`).all(userId);

/** החלוקה שמוצגת לשני הצדדים לפני ההזמנה */
export function serviceSplit(price) {
  const fee = feePerTicket(price, config.contentFeeBps);
  return { price, fee, creator: price - fee };
}

// ---------- איכות ואמינות: מדדים שנמדדים בפועל, לא עוקבים ----------

export function creatorStats(db, userId) {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS completed,
              COALESCE(SUM(CASE WHEN submitted_at <= due_at THEN 1 ELSE 0 END), 0) AS on_time,
              COALESCE(SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM revision_requests rr WHERE rr.order_id = o.id) THEN 1 ELSE 0 END), 0) AS first_try,
              COUNT(DISTINCT artist_id) AS artists
         FROM service_orders o WHERE creator_id = ? AND status = 'completed'`
    )
    .get(userId);
  return r;
}

/**
 * גילוי יוצרים (התאמה מבוססת חוקים ותגיות, PRD §14):
 * סגנון מוזיקלי משותף עם ההופעות של האמן, עיר, עבודות שהושלמו ועמידה בזמנים.
 * מספר העוקבים בכוונה לא משתתף בדירוג.
 */
export function discoverCreators(db, { viewerId = null, kind = "" } = {}) {
  const artistGenres = new Set();
  const artistCities = new Set();
  if (viewerId) {
    for (const r of db
      .prepare(`SELECT e.genre, e.city FROM events e JOIN artist_members m ON m.artist_id = e.artist_id WHERE m.user_id = ?`)
      .all(viewerId)) {
      if (r.genre) artistGenres.add(r.genre);
      if (r.city) artistCities.add(r.city);
    }
  }
  const rows = db
    .prepare(
      `SELECT p.* FROM creator_profiles p JOIN users u ON u.id = p.user_id
        WHERE p.status = 'active' AND u.frozen_at IS NULL AND p.user_id != COALESCE(?, -1)
          AND EXISTS (SELECT 1 FROM creator_services s WHERE s.user_id = p.user_id AND s.active = 1)`
    )
    .all(viewerId);
  const out = [];
  for (const p of rows) {
    let services = servicesOf(db, p.user_id, { activeOnly: true });
    if (kind) services = services.filter((s) => TEMPLATES[s.template].kind === kind);
    if (!services.length) continue;
    const stats = creatorStats(db, p.user_id);
    const genres = p.genres ? p.genres.split(",") : [];
    const match = genres.filter((g) => artistGenres.has(g));
    let score = match.length * 20 + (artistCities.has(p.city) ? 10 : 0) + Math.min(stats.completed * 3, 15);
    if (stats.completed) score += (stats.on_time / stats.completed) * 10;
    out.push({ ...p, services, stats, match, score, sample: portfolio(db, p.user_id)[0] ?? null });
  }
  return out.sort((a, b) => b.score - a.score || a.services[0].price_agorot - b.services[0].price_agorot);
}

// ---------- הזמנה ----------

const GOALS = {
  show: "שיותר אנשים יגיעו להופעה",
  music: "שיותר אנשים יכירו את המוזיקה",
  content: "תוכן לערוצים של האמן",
  buzz: "שידברו על האמן ברשתות",
};
export { GOALS };

/** בריף אוטומטי מהנתונים שכבר יש במערכת — האמן לא כותב מסמך שיווקי (PRD §7.3) */
export function buildBrief({ artistName, goal, musicUrl, campaign, service, dueAt, notes, licenseKey, link }) {
  const lines = [
    `אמן: ${artistName}`,
    `מטרה: ${GOALS[goal] ?? GOALS.content}`,
    `מה צריך: ${service.title}. ${service.deliverable}`,
  ];
  if (campaign) lines.push(`הופעה: ${campaign.title}, ${showDate(campaign.starts_at)}, ${campaign.venue}${campaign.city ? `, ${campaign.city}` : ""}`);
  if (musicUrl) lines.push(`מוזיקה: ${musicUrl}`);
  lines.push(`אספקה: תוך ${service.delivery_days} ימים מאישור ההזמנה`);
  lines.push(`זכויות שימוש: ${LICENSES[licenseKey].label}`);
  if (service.includes_publication) lines.push("כולל פרסום בערוץ של היוצר: עם גילוי נאות (\"שיתוף פעולה בתשלום\").");
  if (link) lines.push(`אפשר לצרף את הלינק האישי למכירת כרטיסים ולקבל עמלה על כל כרטיס.`);
  lines.push("אין צורך להחמיא: אפשר להביע דעה כנה. אין לייחס חוויה שלא קרתה.");
  if (notes) lines.push("", `הערות האמן: ${notes}`);
  return lines.join("\n");
}

export function placeOrder(db, artistUser, serviceId, input) {
  return tx(db, () => {
    const s = getService(db, serviceId);
    if (!s || !s.active) throw new UserError("השירות לא זמין כרגע");
    if (s.user_id === artistUser.id) throw new UserError("אי אפשר להזמין שירות מעצמך");
    const creator = getUser(db, s.user_id);
    const profile = getProfile(db, s.user_id);
    if (creator.frozen_at || profile?.status !== "active") throw new UserError("היוצר לא זמין כרגע");
    if (input.rights !== "on") throw new UserError("צריך לאשר שיש לך זכות להעביר את החומרים ליוצר");

    // אמן: קיים של המשתמש, או חדש לפי השם
    const artistName = text(input.artist_name, "שם האמן");
    let artist = db
      .prepare("SELECT a.* FROM artists a JOIN artist_members m ON m.artist_id = a.id WHERE m.user_id = ? AND a.name = ?")
      .get(artistUser.id, artistName);
    if (!artist) {
      const id = insert(db, "artists", { name: artistName, created_at: clock.iso() });
      insert(db, "artist_members", { artist_id: id, user_id: artistUser.id, role: "owner" });
      artist = { id, name: artistName };
    }
    let campaign = null;
    if (input.campaign_id) {
      campaign = getCampaign(db, input.campaign_id);
      if (!campaign || campaign.artist_id !== artist.id) throw new UserError("ההופעה לא שייכת לאמן הזה");
    }
    const musicUrl = input.music_url ? httpsUrl(input.music_url, "קישור למוזיקה") : "";
    const notes = text(input.notes, "הערות", { max: 1000, required: false });
    const split = serviceSplit(s.price_agorot);
    const dueAt = addDays(clock.iso(), s.delivery_days);
    const terms = {
      service_id: s.id, template: s.template, title: s.title, deliverable: s.deliverable, description: s.description,
      price_agorot: s.price_agorot, fee_bps: config.contentFeeBps, fee_agorot: split.fee, creator_amount_agorot: split.creator,
      delivery_days: s.delivery_days, revisions: s.revisions, license: s.license, license_points: LICENSES[s.license].points,
      includes_publication: !!s.includes_publication, auto_approve_days: config.autoApproveDays, agreed_at: clock.iso(),
      joker_share: s.license !== "exposure",
    };
    const now = clock.iso();
    const orderId = insert(db, "service_orders", {
      service_id: s.id, creator_id: s.user_id, artist_id: artist.id, artist_user_id: artistUser.id,
      campaign_id: campaign?.id ?? null, status: "requested", title: s.title, terms_json: JSON.stringify(terms),
      price_agorot: s.price_agorot, fee_agorot: split.fee, creator_amount_agorot: split.creator,
      includes_publication: s.includes_publication,
      brief: buildBrief({ artistName, goal: input.goal, musicUrl, campaign, service: s, dueAt, notes, licenseKey: s.license, link: campaign?.status === "active" }),
      revisions_left: s.revisions, due_at: dueAt, created_at: now, updated_at: now,
    });
    payments.authorize(db, orderId, s.price_agorot);
    audit(db, artistUser.id, "service_order.placed", "service_order", orderId, { price: s.price_agorot, creator: s.user_id });
    // אם ההזמנה נולדה מהצעה של ג׳וקר, ההצעה נסגרת
    if (campaign) {
      db.prepare("UPDATE service_offers SET status = 'ordered', order_id = ?, updated_at = ? WHERE campaign_id = ? AND service_id = ? AND status = 'open'").run(orderId, now, campaign.id, s.id);
    }
    notify(db, s.user_id, `הזמנה חדשה: ${s.title} מ${artistName}, ${money(split.creator)} בשבילך. מחכה לאישור שלך.`, `/orders/${orderId}`, { email: true });
    return orderId;
  });
}

const ORDER_SELECT = `
  SELECT o.*, a.name AS artist_name, p.display_name AS creator_name, cu.email AS creator_email,
         pay.status AS payment_status, pay.captured_agorot
    FROM service_orders o
    JOIN artists a ON a.id = o.artist_id
    JOIN users cu ON cu.id = o.creator_id
    LEFT JOIN creator_profiles p ON p.user_id = o.creator_id
    LEFT JOIN service_payments pay ON pay.order_id = o.id`;

export function getOrder(db, id) {
  const o = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(Number(id));
  if (o) o.terms = JSON.parse(o.terms_json);
  return o;
}
export const ordersForCreator = (db, uid) =>
  db.prepare(`${ORDER_SELECT} WHERE o.creator_id = ? ORDER BY o.status IN ('completed','cancelled'), o.id DESC`).all(uid);
export const ordersForArtist = (db, uid) =>
  db.prepare(`${ORDER_SELECT} WHERE o.artist_user_id = ? ORDER BY o.status IN ('completed','cancelled'), o.id DESC`).all(uid);
export const allOrders = (db) => db.prepare(`${ORDER_SELECT} ORDER BY o.status = 'disputed' DESC, o.id DESC LIMIT 300`).all();

export function roleIn(order, user) {
  if (!user || !order) return null;
  if (order.creator_id === user.id) return "creator";
  if (order.artist_user_id === user.id) return "artist";
  if (user.is_admin) return "admin";
  return null;
}

export const deliverablesOf = (db, orderId) => db.prepare("SELECT * FROM deliverables WHERE order_id = ? ORDER BY version DESC").all(orderId);
export const revisionsOf = (db, orderId) => db.prepare("SELECT * FROM revision_requests WHERE order_id = ? ORDER BY id DESC").all(orderId);
export const publicationOf = (db, orderId) => db.prepare("SELECT * FROM publications WHERE order_id = ?").get(orderId);

function move(db, order, to, actorId, extra = {}) {
  if (!ORDER_TRANSITIONS[order.status].includes(to)) {
    throw new UserError(`אי אפשר לעבור מ"${ORDER_STATUS[order.status]}" ל"${ORDER_STATUS[to]}"`);
  }
  const sets = { status: to, updated_at: clock.iso(), ...extra };
  const cols = Object.keys(sets).map((k) => `${k} = :${k}`).join(", ");
  db.prepare(`UPDATE service_orders SET ${cols} WHERE id = :id AND status = :from`).run({ ...sets, id: order.id, from: order.status });
  audit(db, actorId ?? null, `service_order.${to}`, "service_order", order.id, { from: order.status });
}

const loadFor = (db, user, orderId, role) => {
  const o = getOrder(db, orderId);
  if (!o) throw new UserError("ההזמנה לא נמצאה", 404);
  const r = roleIn(o, user);
  if (!r || (role && r !== role && r !== "admin")) throw new UserError("ההזמנה לא נמצאה", 404);
  return o;
};

// ---------- פעולות היוצר ----------

export function acceptOrder(db, user, orderId) {
  return tx(db, () => {
    const o = loadFor(db, user, orderId, "creator");
    let linkId = null;
    if (o.campaign_id) {
      const c = getCampaign(db, o.campaign_id);
      // מודל היברידי: היוצר מקבל לינק אישי לכרטיסים, ותגמול לכל כרטיס בנוסף לתשלום על העבודה
      if (c.status === "active") linkId = getOrCreateLink(db, user, c.id).id;
    }
    move(db, o, "accepted", user.id, { accepted_at: clock.iso(), link_id: linkId, due_at: addDays(clock.iso(), o.terms.delivery_days) });
    notify(db, o.artist_user_id, `${o.creator_name} אישר/ה את ההזמנה "${o.title}" ומתחיל/ה לעבוד.`, `/orders/${o.id}`);
  });
}

export function declineOrder(db, user, orderId, reason = "") {
  return tx(db, () => {
    const o = loadFor(db, user, orderId, "creator");
    if (o.status !== "requested") throw new UserError("אפשר לסרב רק לפני שהתחלת");
    move(db, o, "cancelled", user.id, { cancelled_at: clock.iso() });
    payments.void(db, o.id);
    notify(db, o.artist_user_id, `${o.creator_name} לא זמין/ה להזמנה "${o.title}". לא חויבת.${reason ? ` (${String(reason).slice(0, 200)})` : ""}`, `/orders/${o.id}`);
  });
}

export function submitDeliverable(db, user, orderId, { url, note, media }) {
  return tx(db, () => {
    const o = loadFor(db, user, orderId, "creator");
    const version = (db.prepare("SELECT MAX(version) v FROM deliverables WHERE order_id = ?").get(o.id).v ?? 0) + 1;
    // קובץ שהועלה (תמונה או סרטון) עדיף: אפשר להכניס אותו לערכת השיתוף אחרי אישור
    const link = media?.data?.length ? saveMedia(media).url : httpsUrl(url, "קישור לתוצר");
    move(db, o, "submitted", user.id, { submitted_at: o.submitted_at ?? clock.iso() });
    insert(db, "deliverables", { order_id: o.id, version, url: link, note: text(note, "הערה", { max: 500, required: false }), created_at: clock.iso() });
    notify(db, o.artist_user_id, `התוצר של "${o.title}" מוכן לצפייה${version > 1 ? ` (גרסה ${version})` : ""}.`, `/orders/${o.id}`, { email: true });
  });
}

export function submitPublication(db, user, orderId, { url }) {
  return tx(db, () => {
    const o = loadFor(db, user, orderId, "creator");
    const link = httpsUrl(url, "קישור לפרסום");
    move(db, o, "published", user.id, { published_at: clock.iso() });
    insert(db, "publications", { order_id: o.id, url: link, submitted_at: clock.iso() });
    notify(db, o.artist_user_id, `${o.creator_name} פרסם/ה את התוכן. בדקו את הקישור ואשרו.`, `/orders/${o.id}`);
  });
}

// ---------- פעולות האמן ----------

export function cancelOrder(db, user, orderId) {
  return tx(db, () => {
    const o = loadFor(db, user, orderId, "artist");
    const overdue = o.status === "accepted" && o.due_at < clock.iso();
    if (o.status !== "requested" && !overdue) {
      throw new UserError(o.status === "accepted" ? "אפשר לבטל עבודה שכבר התחילה רק אם עבר מועד האספקה" : "אי אפשר לבטל בשלב הזה. אפשר לפנות לצוות.");
    }
    move(db, o, "cancelled", user.id, { cancelled_at: clock.iso() });
    payments.void(db, o.id);
    notify(db, o.creator_id, `ההזמנה "${o.title}" בוטלה${overdue ? " כי עבר מועד האספקה" : ""}.`, `/orders/${o.id}`);
  });
}

export function requestRevision(db, user, orderId, message) {
  return tx(db, () => {
    const o = loadFor(db, user, orderId, "artist");
    if (o.revisions_left < 1) throw new UserError("סבבי התיקון שנכללו בהזמנה נוצלו. אפשר לאשר או לפנות לצוות.");
    const msg = text(message, "מה לתקן", { max: 1000 });
    move(db, o, "revision_requested", user.id, { revisions_left: o.revisions_left - 1 });
    insert(db, "revision_requests", { order_id: o.id, message: msg, created_at: clock.iso() });
    notify(db, o.creator_id, `בקשת תיקון ל"${o.title}": ${msg.slice(0, 120)}`, `/orders/${o.id}`);
  });
}

export function approveOrder(db, user, orderId, { auto = false } = {}) {
  return tx(db, () => {
    const o = auto ? getOrder(db, orderId) : loadFor(db, user, orderId, "artist");
    if (o.status !== "submitted") throw new UserError(`אי אפשר לעבור מ"${ORDER_STATUS[o.status]}" לאישור`);
    if (o.includes_publication) {
      move(db, o, "approved", user?.id, { approved_at: clock.iso() });
      notify(db, o.creator_id, `התוצר של "${o.title}" אושר${auto ? " אוטומטית" : ""}. עכשיו מפרסמים ומוסיפים כאן את הקישור.`, `/orders/${o.id}`);
    } else {
      move(db, o, "completed", user?.id, { approved_at: clock.iso(), completed_at: clock.iso() });
      payOut(db, o, o.price_agorot, auto ? "אושר אוטומטית" : "");
    }
    addToKit(db, o);
  });
}

/**
 * תוכן שאושר נכנס לערכת השיתוף של ההופעה, כך שכל הג׳וקרים יכולים לשתף אותו.
 * רק כשההזמנה קשורה להופעה, הזכויות מאפשרות (joker_share), והתוצר הוא קובץ שהועלה אצלנו.
 */
function addToKit(db, o) {
  const last = deliverablesOf(db, o.id)[0];
  if (!o.campaign_id || !o.terms.joker_share || !last || !ANY_MEDIA_RE.test(last.url)) return false;
  if (db.prepare("SELECT 1 FROM campaign_assets WHERE service_order_id = ?").get(o.id)) return false;
  addAsset(db, { id: o.artist_user_id }, o.campaign_id, { url: last.url, kind: mediaKind(last.url), credit: o.creator_name, serviceOrderId: o.id });
  notify(db, o.creator_id, `העבודה שלך על "${o.title}" נכנסה לערכת השיתוף של ההופעה. ג׳וקרים יכולים לשתף אותה, עם קרדיט לך.`, `/orders/${o.id}`);
  return true;
}

// ---------- ג׳וקר מציע שירות לאמן ----------

/**
 * ג׳וקר שיש לו פרופיל יוצר מציע לאמן של ההופעה אחד מהשירותים שלו (למשל סרטון המלצה).
 * האמן מקבל התראה, וההזמנה עצמה עוברת בדיוק כמו כל הזמנה: מחיר ידוע, תשלום רק אחרי אישור.
 */
export function offerService(db, user, campaignId, { service_id, message }) {
  return tx(db, () => {
    const c = getCampaign(db, campaignId);
    if (!c || !["active", "paused"].includes(c.status)) throw new UserError("ההופעה לא פתוחה להצעות כרגע");
    const s = getService(db, service_id);
    if (!s || s.user_id !== user.id || !s.active) throw new UserError("בחרו אחד מהשירותים שלך");
    if (getProfile(db, user.id)?.status !== "active") throw new UserError("הפרופיל שלך עוד לא פעיל");
    const owners = db.prepare("SELECT user_id FROM artist_members WHERE artist_id = ?").all(c.artist_id).map((r) => r.user_id);
    if (owners.includes(user.id)) throw new UserError("אי אפשר להציע שירות לעצמך");
    if (db.prepare("SELECT 1 FROM service_offers WHERE campaign_id = ? AND creator_id = ? AND status = 'open'").get(c.id, user.id)) {
      throw new UserError("כבר שלחת הצעה להופעה הזאת. האמן יחליט.");
    }
    const recent = db.prepare("SELECT COUNT(*) n FROM service_offers WHERE creator_id = ? AND created_at > ?").get(user.id, addDays(clock.iso(), -1)).n;
    if (recent >= 5) throw new UserError("אפשר לשלוח עד 5 הצעות ביום");
    const now = clock.iso();
    const id = insert(db, "service_offers", {
      campaign_id: c.id, service_id: s.id, creator_id: user.id, message: text(message, "הודעה לאמן", { max: 300, required: false }), created_at: now, updated_at: now,
    });
    const name = getProfile(db, user.id).display_name;
    for (const uid of owners) notify(db, uid, `${name}, ג׳וקר/ית של "${c.title}", מציע/ה לך: ${s.title} ב-${money(s.price_agorot)}.`, `/artist/c/${c.id}#offers`, { email: true });
    audit(db, user.id, "offer.created", "campaign", c.id, { service: s.id });
    return id;
  });
}

export const offersFor = (db, campaignId) =>
  db.prepare(
    `SELECT f.*, s.title, s.price_agorot, s.deliverable, s.template, p.display_name, p.image_url, p.user_id AS creator_user_id,
            (SELECT COUNT(*) FROM referral_links l JOIN orders x ON x.link_id = l.id WHERE l.campaign_id = f.campaign_id AND l.promoter_id = f.creator_id AND x.cancelled = 0) AS sales
       FROM service_offers f JOIN creator_services s ON s.id = f.service_id JOIN creator_profiles p ON p.user_id = f.creator_id
      WHERE f.campaign_id = ? AND f.status = 'open' ORDER BY f.id DESC`
  ).all(campaignId);

export function dismissOffer(db, user, campaignId, offerId) {
  const n = db.prepare("UPDATE service_offers SET status = 'dismissed', updated_at = ? WHERE id = ? AND campaign_id = ? AND status = 'open'").run(clock.iso(), Number(offerId), campaignId).changes;
  if (n) audit(db, user.id, "offer.dismissed", "campaign", campaignId, { offer: Number(offerId) });
}

export const myOffer = (db, userId, campaignId) =>
  db.prepare("SELECT f.*, s.title FROM service_offers f JOIN creator_services s ON s.id = f.service_id WHERE f.creator_id = ? AND f.campaign_id = ? ORDER BY f.id DESC LIMIT 1").get(userId, campaignId);

export function verifyPublication(db, user, orderId, { auto = false } = {}) {
  return tx(db, () => {
    const o = auto ? getOrder(db, orderId) : loadFor(db, user, orderId, "artist");
    if (o.status !== "published") throw new UserError("אין פרסום שמחכה לאימות");
    move(db, o, "completed", user?.id, { completed_at: clock.iso() });
    db.prepare("UPDATE publications SET verified_at = ?, verified_by = ?, method = ? WHERE order_id = ?").run(
      clock.iso(), user?.id ?? null, auto ? "auto_link" : user?.is_admin && user.id !== o.artist_user_id ? "admin" : "artist", o.id
    );
    payOut(db, o, o.price_agorot, auto ? "הפרסום נחשב מאומת לפי הקישור" : "");
  });
}

/** חיוב האמן (אצל ספק התשלומים) וזיכוי היוצר ביומן. capture < מחיר = פשרה במחלוקת. */
function payOut(db, o, capture, memo = "") {
  payments.capture(db, o.id, capture);
  if (capture === 0) return;
  const fee = feePerTicket(capture, o.terms.fee_bps);
  const amount = capture - fee;
  const now = clock.iso();
  const cid = insert(db, "commissions", {
    kind: "service", service_order_id: o.id, promoter_id: o.creator_id, amount_agorot: amount,
    status: "payable", note: memo, created_at: now, updated_at: now, payable_at: now,
  });
  insert(db, "ledger", { commission_id: cid, user_id: o.creator_id, type: "accrue", amount_agorot: amount, memo: `עבודת תוכן: ${o.title}${memo ? ` · ${memo}` : ""}`, created_at: now });
  db.prepare("UPDATE service_orders SET fee_agorot = ?, creator_amount_agorot = ? WHERE id = ?").run(fee, amount, o.id);
  notify(db, o.creator_id, `העבודה "${o.title}" הושלמה. ${money(amount)} זמינים לתשלום.`, "/me/money");
  notify(db, o.artist_user_id, `ההזמנה "${o.title}" הושלמה וחויבת ${money(capture)}.`, `/orders/${o.id}`);
}

// ---------- מחלוקות ----------

export function openOrderDispute(db, user, orderId, message) {
  return tx(db, () => {
    const o = loadFor(db, user, orderId);
    move(db, o, "disputed", user.id, { disputed_from: o.status });
    insert(db, "disputes", { user_id: user.id, service_order_id: o.id, message: text(message, "מה קרה", { max: 1000 }), created_at: clock.iso() });
    const other = user.id === o.creator_id ? o.artist_user_id : o.creator_id;
    notify(db, other, `נפתחה פנייה לצוות על "${o.title}". הצוות יחזור לשניכם.`, `/orders/${o.id}`);
  });
}

/** החלטת צוות: תשלום מלא ליוצר, החזר מלא לאמן, או פשרה (חיוב חלקי) */
export function resolveOrderDispute(db, admin, orderId, { outcome, amount, resolution }) {
  return tx(db, () => {
    const o = getOrder(db, orderId);
    if (!o || o.status !== "disputed") throw new UserError("ההזמנה לא במחלוקת");
    const note = text(resolution, "הסבר לשני הצדדים", { max: 500 });
    let capture = 0;
    if (outcome === "pay") capture = o.price_agorot;
    else if (outcome === "split") {
      capture = shekelsToAgorot(amount);
      if (!capture || capture >= o.price_agorot) throw new UserError("סכום הפשרה צריך להיות בין 0 למחיר המלא");
    }
    if (capture > 0) {
      move(db, o, "completed", admin.id, { completed_at: clock.iso() });
      payOut(db, o, capture, `החלטת צוות: ${note}`);
    } else {
      move(db, o, "cancelled", admin.id, { cancelled_at: clock.iso() });
      payments.void(db, o.id);
    }
    db.prepare("UPDATE disputes SET status = 'resolved', resolution = ?, resolved_at = ?, resolved_by = ? WHERE service_order_id = ? AND status = 'open'").run(note, clock.iso(), admin.id, o.id);
    for (const uid of [o.creator_id, o.artist_user_id]) notify(db, uid, `הצוות החליט לגבי "${o.title}": ${note}`, `/orders/${o.id}`);
  });
}

// ---------- אוטומציה (רץ עם settle) ----------

/**
 * הגנות זמן לשני הצדדים:
 *  יוצר לא הגיב תוך 3 ימים → ההזמנה מתבטלת והאמן לא מחויב
 *  אמן לא הגיב לתוצר תוך 5 ימים → מאושר אוטומטית והיוצר מקבל את הכסף
 *  אמן לא אימת פרסום תוך 3 ימים → נחשב מאומת לפי הקישור (ומסומן ככזה)
 */
export function settleContent(db) {
  const now = clock.iso();
  let n = 0;
  for (const o of db.prepare("SELECT id FROM service_orders WHERE status = 'requested' AND created_at <= ?").all(addDays(now, -config.acceptWindowDays))) {
    tx(db, () => {
      const order = getOrder(db, o.id);
      move(db, order, "cancelled", null, { cancelled_at: now });
      payments.void(db, order.id);
      notify(db, order.artist_user_id, `${order.creator_name} לא הגיב/ה להזמנה "${order.title}" בזמן, אז היא בוטלה. לא חויבת.`, `/orders/${order.id}`);
    });
    n++;
  }
  for (const o of db.prepare("SELECT id FROM service_orders WHERE status = 'submitted' AND updated_at <= ?").all(addDays(now, -config.autoApproveDays))) {
    approveOrder(db, null, o.id, { auto: true });
    n++;
  }
  for (const o of db.prepare("SELECT id FROM service_orders WHERE status = 'published' AND published_at <= ?").all(addDays(now, -config.publicationVerifyDays))) {
    verifyPublication(db, null, o.id, { auto: true });
    n++;
  }
  return n;
}

/** בדיקת התאמה: כל הזמנה שהושלמה חויבה, והיוצר זוכה בדיוק בחיוב פחות העמלה */
export function contentReconciliationIssues(db) {
  return db
    .prepare(
      `SELECT o.id, o.status, pay.status AS ps, pay.captured_agorot AS cap, o.fee_agorot AS fee,
              COALESCE((SELECT SUM(amount_agorot) FROM commissions m WHERE m.service_order_id = o.id), 0) AS earned
         FROM service_orders o LEFT JOIN service_payments pay ON pay.order_id = o.id`
    )
    .all()
    .filter((r) =>
      r.status === "completed" ? r.ps !== "captured" || r.cap - r.fee !== r.earned
        : r.status === "cancelled" ? r.ps !== "voided" || r.earned !== 0
          : r.ps !== "authorized" || r.earned !== 0
    )
    .map((r) => `הזמנת תוכן #${r.id}: מצב ${r.status}, תשלום ${r.ps}, חויב ${r.cap}, זוכה ${r.earned}`);
}

export const creatorPublic = (db, userId) => {
  const p = getProfile(db, userId);
  if (!p) return null;
  return { ...p, services: servicesOf(db, userId, { activeOnly: true }), stats: creatorStats(db, userId), portfolio: portfolio(db, userId), channels: channels(db, userId), firstName: publicName({ name: p.display_name }) };
};
