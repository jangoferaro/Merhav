// משפך מכירה לכל הופעה: צפיות בעמוד → כניסה לקופה → הזמנה → תשלום, ומה הגיע דרך ג׳וקרים.
// בלי עוגיות מעקב ובלי פרטים אישיים: רק מונים לפי יום ומקור. בוטים לא נספרים.
import { clock } from "../util.js";

export function migrateFunnel(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_views (
      campaign_id INTEGER NOT NULL,
      day         TEXT NOT NULL,
      kind        TEXT NOT NULL,   -- show | checkout
      source      TEXT NOT NULL,   -- joker | direct
      n           INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (campaign_id, day, kind, source)
    );
  `);
}

export function countView(db, campaignId, kind, viaJoker) {
  db.prepare(
    `INSERT INTO page_views (campaign_id, day, kind, source, n) VALUES (?, ?, ?, ?, 1)
     ON CONFLICT (campaign_id, day, kind, source) DO UPDATE SET n = n + 1`
  ).run(Number(campaignId), clock.iso().slice(0, 10), kind, viaJoker ? "joker" : "direct");
}

export function funnel(db, campaignId) {
  const v = (kind, source) =>
    db.prepare(`SELECT COALESCE(SUM(n), 0) n FROM page_views WHERE campaign_id = ? AND kind = ?${source ? " AND source = ?" : ""}`).get(...[campaignId, kind, source].filter(Boolean)).n;
  const o = (where) => db.prepare(`SELECT COUNT(*) n FROM ticket_orders WHERE campaign_id = ? ${where}`).get(campaignId).n;
  const views = v("show");
  const checkout = v("checkout");
  const orders = o("");
  const paid = o("AND status = 'paid'");
  const paidJoker = o("AND status = 'paid' AND click_token IS NOT NULL");
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  return {
    views, views_joker: v("show", "joker"), checkout, orders, paid, paid_joker: paidJoker,
    to_checkout: pct(checkout, views), to_paid: pct(paid, checkout), joker_share: pct(paidJoker, paid),
  };
}
