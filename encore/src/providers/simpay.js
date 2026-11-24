// ספק תשלומים מדומה (Sandbox) להזמנות תוכן.
// מודל "הרשאה ואז חיוב": הכסף של האמן נתפס כהרשאה בכרטיס אצל הספק כשהוא מזמין,
// ונגבה בפועל רק כשהעבודה הושלמה. ביטול → ההרשאה משוחררת. הפלטפורמה לא מחזיקה כספים.
// ספק אמיתי (למשל Stripe / Grow / Cardcom) יחליף את שלוש הפונקציות האלה.
import { insert } from "../db.js";
import { clock, shortCode, UserError } from "../util.js";

export const simPay = {
  name: "simpay",

  authorize(db, orderId, amount) {
    if (!Number.isInteger(amount) || amount <= 0) throw new UserError("סכום לא תקין");
    const id = insert(db, "service_payments", {
      order_id: orderId, provider: "simpay", external_id: `pi_${shortCode(14)}`, amount_agorot: amount,
      status: "authorized", created_at: clock.iso(), updated_at: clock.iso(),
    });
    return db.prepare("SELECT * FROM service_payments WHERE id = ?").get(id);
  },

  /** חיוב של חלק או כל ההרשאה. היתרה משוחררת אוטומטית. */
  capture(db, orderId, amount) {
    const p = db.prepare("SELECT * FROM service_payments WHERE order_id = ?").get(orderId);
    if (!p || p.status !== "authorized") throw new Error(`payment not capturable: ${p?.status}`);
    if (amount < 0 || amount > p.amount_agorot) throw new Error("capture exceeds authorization");
    db.prepare("UPDATE service_payments SET status = ?, captured_agorot = ?, updated_at = ? WHERE id = ?").run(
      amount > 0 ? "captured" : "voided", amount, clock.iso(), p.id
    );
  },

  void(db, orderId) {
    const p = db.prepare("SELECT * FROM service_payments WHERE order_id = ?").get(orderId);
    if (p?.status === "authorized") {
      db.prepare("UPDATE service_payments SET status = 'voided', updated_at = ? WHERE id = ?").run(clock.iso(), p.id);
    }
  },
};
