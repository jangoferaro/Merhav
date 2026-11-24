// Financial Ledger & Payouts: יתרות, בקשות תשלום, שחרור תגמולים אחרי ההופעה, מחלוקות והתאמות.
import { insert, tx } from "../db.js";
import { addDays, clock, config, decrypt, encrypt, money, shekelsToAgorot, text, UserError } from "../util.js";
import { audit, notify } from "./identity.js";
import { contentReconciliationIssues, settleContent } from "./content.js";
import { expireHolds, ticketIssues } from "./tickets.js";

/**
 * שלושה מצבים ברורים למקדם (PRD §9.7):
 *  pending   — ממתין לאישור: ההופעה עוד לא התקיימה / חלון ההחזרים לא נסגר
 *  available — זמין לתשלום (כולל קיזוזים, ולכן יכול להיות שלילי)
 *  paid      — שולם בפועל
 * בנוסף: inTransit (ביקשת, בדרך אליך) ו-disputed (בבדיקה).
 */
export function balances(db, userId) {
  const q = (sql) => db.prepare(sql).get(userId).n;
  return {
    pending: q("SELECT COALESCE(SUM(amount_agorot),0) n FROM commissions WHERE promoter_id = ? AND status = 'pending'"),
    available: q("SELECT COALESCE(SUM(amount_agorot),0) n FROM commissions WHERE promoter_id = ? AND status = 'payable' AND payout_id IS NULL"),
    disputed: q("SELECT COALESCE(SUM(amount_agorot),0) n FROM commissions WHERE promoter_id = ? AND status = 'disputed'"),
    inTransit: q("SELECT COALESCE(SUM(amount_agorot),0) n FROM payouts WHERE user_id = ? AND status = 'requested'"),
    paid: q("SELECT COALESCE(SUM(amount_agorot),0) n FROM payouts WHERE user_id = ? AND status = 'paid'"),
  };
}

/** מתי הכסף צפוי להיות זמין: X ימים אחרי ההופעה */
export const availableFrom = (startsAt) => addDays(startsAt, config.holdDaysAfterShow);

export function salesByShow(db, userId) {
  return db
    .prepare(
      `SELECT c.id AS campaign_id, c.status AS campaign_status, e.title, e.starts_at, a.name AS artist_name, l.code,
              (SELECT COUNT(DISTINCT visitor_hash) FROM referral_clicks k WHERE k.link_id = l.id) AS clicks,
              COALESCE((SELECT SUM(MIN(o.rewarded_qty, o.qty - o.refunded_qty)) FROM orders o WHERE o.link_id = l.id AND o.cancelled = 0), 0) AS tickets,
              COALESCE((SELECT SUM(amount_agorot) FROM commissions m WHERE m.campaign_id = c.id AND m.promoter_id = l.promoter_id AND m.status != 'reversed'), 0) AS earned,
              COALESCE((SELECT SUM(amount_agorot) FROM commissions m WHERE m.campaign_id = c.id AND m.promoter_id = l.promoter_id AND m.status = 'pending'), 0) AS pending
         FROM referral_links l
         JOIN campaigns c ON c.id = l.campaign_id
         JOIN events e ON e.id = c.event_id
         JOIN artists a ON a.id = c.artist_id
        WHERE l.promoter_id = ?
        ORDER BY e.starts_at DESC`
    )
    .all(userId);
}

export function commissionsOf(db, userId, limit = 100) {
  return db
    .prepare(
      `SELECT m.*, COALESCE(e.title, so.title) AS title, e.starts_at, o.qty, o.refunded_qty, o.rewarded_qty
         FROM commissions m
         LEFT JOIN service_orders so ON so.id = m.service_order_id
         LEFT JOIN orders o ON o.id = m.order_id
         LEFT JOIN campaigns c ON c.id = m.campaign_id
         LEFT JOIN events e ON e.id = c.event_id
        WHERE m.promoter_id = ? ORDER BY m.id DESC LIMIT ?`
    )
    .all(userId, limit);
}

// ---------- פרטי תשלום (מוצפנים) ----------

export function savePayoutDetails(db, user, input) {
  const method = input.method === "bank" ? "bank" : "bit";
  const details = { full_name: text(input.full_name, "שם מלא כפי שמופיע בחשבון", { max: 80 }), method };
  if (method === "bit") {
    const phone = String(input.phone ?? "").replace(/\D/g, "");
    if (!/^05\d{8}$/.test(phone)) throw new UserError("מספר טלפון נייד לא תקין");
    details.phone = phone;
  } else {
    details.bank = text(input.bank, "בנק", { max: 30 });
    details.branch = text(input.branch, "סניף", { max: 10 });
    details.account = text(input.account, "מספר חשבון", { max: 20 });
  }
  if (input.adult !== "on") throw new UserError("כדי לקבל תשלום צריך לאשר שמלאו לך 18");
  db.prepare("UPDATE users SET payout_details_enc = ?, adult_confirmed_at = COALESCE(adult_confirmed_at, ?) WHERE id = ?").run(
    encrypt(details), clock.iso(), user.id
  );
  audit(db, user.id, "payout_details.updated", "user", user.id, { method }); // בלי הפרטים עצמם
}

export const payoutDetails = (user) => (user?.payout_details_enc ? decrypt(user.payout_details_enc) : null);

export function maskDetails(d) {
  if (!d) return "";
  return d.method === "bit" ? `ביט/פייבוקס · ${d.phone.slice(0, 3)}-•••-${d.phone.slice(-2)}` : `בנק ${d.bank} · חשבון •••${d.account.slice(-3)}`;
}

// ---------- בקשת תשלום ----------

export function requestPayout(db, user) {
  return tx(db, () => {
    const fresh = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    if (!fresh.payout_details_enc || !fresh.adult_confirmed_at) throw new UserError("קודם ממלאים לאן להעביר את הכסף");
    if (fresh.frozen_at) throw new UserError("החשבון מוקפא", 403);
    if (db.prepare("SELECT 1 FROM payouts WHERE user_id = ? AND status = 'requested'").get(user.id)) {
      throw new UserError("כבר יש בקשת תשלום בטיפול");
    }
    const amount = balances(db, user.id).available;
    if (amount < config.minPayoutAgorot) throw new UserError(`אפשר לבקש תשלום מ-${money(config.minPayoutAgorot)} ומעלה`);
    const id = insert(db, "payouts", { user_id: user.id, amount_agorot: amount, status: "requested", created_at: clock.iso() });
    const attached = db
      .prepare("UPDATE commissions SET payout_id = ?, updated_at = ? WHERE promoter_id = ? AND status = 'payable' AND payout_id IS NULL")
      .run(id, clock.iso(), user.id).changes;
    const check = db.prepare("SELECT COALESCE(SUM(amount_agorot),0) n FROM commissions WHERE payout_id = ?").get(id).n;
    if (check !== amount) throw new Error("payout amount mismatch"); // לא אמור לקרות; מבטל הכל
    audit(db, user.id, "payout.requested", "payout", id, { amount, commissions: attached });
    return id;
  });
}

/** צוות התפעול מאשר שהעברה בוצעה (או נכשלה). פועל רק על בקשה פתוחה — לחיצה כפולה לא משלמת פעמיים. */
export function decidePayout(db, admin, payoutId, outcome, reference = "") {
  return tx(db, () => {
    const p = db.prepare("SELECT * FROM payouts WHERE id = ?").get(Number(payoutId));
    if (!p) throw new UserError("בקשה לא נמצאה", 404);
    if (p.status !== "requested") return p;
    const now = clock.iso();
    if (outcome === "paid") {
      const ref = text(reference, "אסמכתא להעברה", { max: 100 });
      db.prepare("UPDATE payouts SET status = 'paid', reference = ?, decided_at = ?, decided_by = ? WHERE id = ?").run(ref, now, admin.id, p.id);
      db.prepare("UPDATE commissions SET status = 'paid', paid_at = ?, updated_at = ? WHERE payout_id = ?").run(now, now, p.id);
      notify(db, p.user_id, `העברנו לך ${money(p.amount_agorot)}`, "/me/money");
    } else {
      db.prepare("UPDATE payouts SET status = 'failed', reference = ?, decided_at = ?, decided_by = ? WHERE id = ?").run(String(reference).slice(0, 200), now, admin.id, p.id);
      db.prepare("UPDATE commissions SET payout_id = NULL, updated_at = ? WHERE payout_id = ?").run(now, p.id);
      notify(db, p.user_id, "ההעברה לא הצליחה. בדקו את פרטי התשלום ובקשו שוב.", "/me/money");
    }
    audit(db, admin.id, `payout.${outcome}`, "payout", p.id, { amount: p.amount_agorot, reference });
    return db.prepare("SELECT * FROM payouts WHERE id = ?").get(p.id);
  });
}

// ---------- שחרור אחרי ההופעה ----------

/**
 * רץ מעצמו כל כמה דקות:
 *  - קמפיינים שההופעה שלהם התחילה → "הסתיים"
 *  - תגמולים ממתינים שעבר חלון ההחזרים (X ימים אחרי ההופעה) → זמינים לתשלום
 *  תגמולים של מקדם מוקפא נשארים ממתינים.
 */
export function settle(db) {
  return tx(db, () => {
    const now = clock.iso();
    const ending = db
      .prepare(`SELECT c.id FROM campaigns c JOIN events e ON e.id = c.event_id WHERE c.status IN ('active','paused','sold_out') AND e.starts_at <= ?`)
      .all(now);
    for (const { id } of ending) {
      db.prepare("UPDATE campaigns SET status = 'ended', updated_at = ? WHERE id = ?").run(now, id);
      audit(db, null, "campaign.status", "campaign", id, { to: "ended", reason: "show_started" });
    }
    const cutoff = addDays(now, -config.holdDaysAfterShow);
    const ready = db
      .prepare(
        `SELECT m.id, m.promoter_id, m.amount_agorot FROM commissions m
           JOIN campaigns c ON c.id = m.campaign_id JOIN events e ON e.id = c.event_id
           JOIN users u ON u.id = m.promoter_id
          WHERE m.status = 'pending' AND e.starts_at <= ? AND c.status != 'cancelled' AND u.frozen_at IS NULL`
      )
      .all(cutoff);
    const perUser = new Map();
    for (const m of ready) {
      db.prepare("UPDATE commissions SET status = 'payable', payable_at = ?, updated_at = ? WHERE id = ?").run(now, now, m.id);
      perUser.set(m.promoter_id, (perUser.get(m.promoter_id) ?? 0) + m.amount_agorot);
    }
    for (const [uid, amount] of perUser) {
      if (amount > 0) notify(db, uid, `${money(amount)} עברו למצב "זמין לתשלום".`, "/me/money");
    }
    return { ended: ending.length, released: ready.length, content: settleContent(db), expired: expireHolds(db) };
  });
}

// ---------- מחלוקות והתאמות ----------

export function openDispute(db, user, { campaign_id, message }) {
  const cid = campaign_id ? Number(campaign_id) : null;
  const id = insert(db, "disputes", {
    user_id: user.id, campaign_id: cid || null, message: text(message, "תיאור", { max: 1000 }), created_at: clock.iso(),
  });
  audit(db, user.id, "dispute.opened", "dispute", id, { campaign_id: cid });
  return id;
}

/** סגירת מחלוקת, אופציונלית עם התאמה כספית מתועדת (חיובית או שלילית) */
export function resolveDispute(db, admin, disputeId, { outcome, resolution, adjustment }) {
  return tx(db, () => {
    const d = db.prepare("SELECT * FROM disputes WHERE id = ?").get(Number(disputeId));
    if (!d || d.status !== "open") throw new UserError("המחלוקת כבר טופלה");
    const status = outcome === "resolved" ? "resolved" : "rejected";
    const note = text(resolution, "הסבר למשתמש", { max: 500 });
    let adj = 0;
    if (String(adjustment ?? "").trim()) {
      const neg = String(adjustment).trim().startsWith("-");
      const v = shekelsToAgorot(String(adjustment).replace(/^[-+]/, ""));
      if (v === null || v === 0) throw new UserError("סכום התאמה לא תקין");
      adj = neg ? -v : v;
      addAdjustment(db, admin, d.user_id, d.campaign_id, adj, `מחלוקת #${d.id}: ${note}`);
    }
    db.prepare("UPDATE disputes SET status = ?, resolution = ?, resolved_at = ?, resolved_by = ? WHERE id = ?").run(status, note, clock.iso(), admin.id, d.id);
    audit(db, admin.id, `dispute.${status}`, "dispute", d.id, { adjustment: adj });
    notify(db, d.user_id, `הפנייה שלך טופלה: ${note}`, "/me/money");
  });
}

export function addAdjustment(db, admin, userId, campaignId, amount, memo) {
  const now = clock.iso();
  const id = insert(db, "commissions", {
    kind: "adjustment", campaign_id: campaignId ?? null, promoter_id: userId, amount_agorot: amount,
    status: "payable", note: memo, created_at: now, updated_at: now, payable_at: now,
  });
  insert(db, "ledger", { commission_id: id, user_id: userId, type: "adjust", amount_agorot: amount, memo, actor_id: admin.id, created_at: now });
  audit(db, admin.id, "commission.adjusted", "commission", id, { user_id: userId, amount, memo });
  return id;
}

/** הקפאת תגמול לבדיקה (חשד להונאה / מחלוקת) או שחרורו */
export function setCommissionDisputed(db, admin, commissionId, disputed) {
  return tx(db, () => {
    const m = db.prepare("SELECT * FROM commissions WHERE id = ?").get(Number(commissionId));
    if (!m) throw new UserError("לא נמצא", 404);
    if (disputed) {
      if (!["pending", "payable"].includes(m.status) || m.payout_id) throw new UserError("אפשר להקפיא רק תגמול שעוד לא בתהליך תשלום");
      db.prepare("UPDATE commissions SET status = 'disputed', note = ?, updated_at = ? WHERE id = ?").run(`was:${m.status}`, clock.iso(), m.id);
    } else {
      if (m.status !== "disputed") return;
      const back = m.note === "was:payable" ? "payable" : "pending";
      db.prepare("UPDATE commissions SET status = ?, note = '', updated_at = ? WHERE id = ?").run(back, clock.iso(), m.id);
    }
    audit(db, admin.id, disputed ? "commission.disputed" : "commission.released", "commission", m.id);
  });
}

/** בדיקת התאמה: היומן מול היתרות, והתשלומים מול התגמולים שהם כוללים. רשימה ריקה = הכל מתאים. */
export function reconciliationIssues(db) {
  const ledger = db
    .prepare(
      `SELECT m.id, m.amount_agorot, COALESCE(SUM(l.amount_agorot),0) AS ledger_sum
         FROM commissions m LEFT JOIN ledger l ON l.commission_id = m.id
        GROUP BY m.id HAVING m.amount_agorot != ledger_sum`
    )
    .all()
    .map((r) => `תגמול #${r.id}: סכום ${r.amount_agorot} אבל ביומן ${r.ledger_sum}`);
  const payouts = db
    .prepare(
      `SELECT p.id, p.amount_agorot, COALESCE(SUM(m.amount_agorot),0) AS sum
         FROM payouts p LEFT JOIN commissions m ON m.payout_id = p.id
        WHERE p.status != 'failed' GROUP BY p.id HAVING p.amount_agorot != sum`
    )
    .all()
    .map((r) => `תשלום #${r.id}: ${r.amount_agorot} אבל התגמולים בו ${r.sum}`);
  return [...ledger, ...payouts, ...contentReconciliationIssues(db), ...ticketIssues(db)];
}
