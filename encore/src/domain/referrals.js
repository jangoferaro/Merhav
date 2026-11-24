// Referral: לינקים אישיים ולחיצות. השיוך עצמו מוכרע רק כשמגיע אישור רכישה מהספק (ingest.js).
import { insert, tx } from "../db.js";
import { clock, hmac, randomToken, shortCode, showDate, UserError } from "../util.js";
import { getCampaign } from "./campaigns.js";
import { audit } from "./identity.js";

/** לינק אחד לכל מקדם בכל קמפיין. לחיצה על "שיתוף" פעם שנייה מחזירה את אותו לינק. */
export function getOrCreateLink(db, user, campaignId) {
  return tx(db, () => {
    const c = getCampaign(db, campaignId);
    if (!c) throw new UserError("ההופעה לא נמצאה", 404);
    const existing = db.prepare("SELECT * FROM referral_links WHERE campaign_id = ? AND promoter_id = ?").get(c.id, user.id);
    if (existing) return existing;
    if (c.status !== "active") throw new UserError("ההופעה הזאת לא פתוחה לקידום כרגע");
    const id = insert(db, "referral_links", { campaign_id: c.id, promoter_id: user.id, code: shortCode(7), created_at: clock.iso() });
    audit(db, user.id, "link.created", "referral_link", id, { campaign_id: c.id });
    return db.prepare("SELECT * FROM referral_links WHERE id = ?").get(id);
  });
}

export const getLinkByCode = (db, code) =>
  db.prepare("SELECT * FROM referral_links WHERE code = ?").get(String(code ?? "").slice(0, 20));

/**
 * רושם לחיצה ומחזיר מזהה הפניה ייחודי שעובר לספק הכרטוס ב-ref.
 * מבקר שלוחץ שוב תוך שעה על אותו לינק מקבל את אותו מזהה (לא מנפחים מספרים).
 */
export function recordClick(db, link, visitorId, referrer = "") {
  const visitorHash = hmac(visitorId, "visitor");
  const hourAgo = new Date(clock.now().getTime() - 3600000).toISOString();
  const recent = db
    .prepare("SELECT * FROM referral_clicks WHERE link_id = ? AND visitor_hash = ? AND created_at > ? ORDER BY id DESC LIMIT 1")
    .get(link.id, visitorHash, hourAgo);
  if (recent) return recent;
  let host = "";
  try {
    host = referrer ? new URL(referrer).hostname.slice(0, 100) : "";
  } catch {}
  const token = `clk_${randomToken(12)}`;
  const id = insert(db, "referral_clicks", { token, link_id: link.id, visitor_hash: visitorHash, referrer_host: host, created_at: clock.iso() });
  return { id, token, link_id: link.id, created_at: clock.iso() };
}

export function linkStats(db, linkId) {
  const clicks = db.prepare("SELECT COUNT(DISTINCT visitor_hash) n FROM referral_clicks WHERE link_id = ?").get(linkId).n;
  const t = db
    .prepare("SELECT COALESCE(SUM(MIN(rewarded_qty, qty - refunded_qty)), 0) n FROM orders WHERE link_id = ? AND cancelled = 0")
    .get(linkId).n;
  return { clicks, tickets: t };
}

/** טקסט מוכן לשיתוף. גילוי נאות על העמלה כלול כברירת מחדל (PRD §9.3). */
export function shareText(campaign, url) {
  const custom = (campaign.share_text || "").trim();
  const intro = custom || `בואו איתי ל${campaign.artist_name} – ${campaign.title} 🎶`;
  return [
    intro,
    `📅 ${showDate(campaign.starts_at)}`,
    `📍 ${campaign.venue}${campaign.city ? `, ${campaign.city}` : ""}`,
    `🎟️ ${url}`,
    "",
    "(גילוי נאות: אני מקבל/ת עמלה על כרטיסים שנקנים דרך הקישור)",
  ].join("\n");
}
