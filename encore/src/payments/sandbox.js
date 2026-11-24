// ספק תשלום מדומה. מתנהג כמו ספק סליקה אמיתי: הקונה עובר לעמוד תשלום שלו, משלם, וחוזר אלינו.
// לא נגבה כסף אמיתי. כרטיס שמתחיל ב-4000 נדחה, כדי לבדוק גם כישלון.
import { insert } from "../db.js";
import { clock, randomToken, UserError } from "../util.js";

const row = (db, ref) => db.prepare("SELECT * FROM pay_sandbox WHERE ref = ?").get(ref);

export const sandboxGateway = {
  name: "sandbox",

  createPayment(db, { amount, description, returnUrl }) {
    if (!Number.isInteger(amount) || amount <= 0) throw new UserError("סכום לא תקין");
    const ref = `sbx_${randomToken(12)}`;
    insert(db, "pay_sandbox", { ref, amount_agorot: amount, description, return_url: returnUrl, created_at: clock.iso() });
    return { ref, redirectUrl: `/pay/sandbox/${ref}` };
  },

  paymentStatus(db, ref) {
    return row(db, ref)?.status ?? "failed";
  },

  verifyNotification() {
    throw new UserError("לספק הניסיון אין התראות שרת", 404);
  },

  async refund(db, ref, amount) {
    const p = row(db, ref);
    if (!p || p.status !== "paid") throw new Error("payment not refundable");
    if (p.refunded_agorot + amount > p.amount_agorot) throw new Error("refund exceeds payment");
    db.prepare("UPDATE pay_sandbox SET refunded_agorot = refunded_agorot + ? WHERE ref = ?").run(amount, ref);
  },
};

// ---------- הצד של "הספק": עמוד התשלום ----------

export const sandboxPayment = row;

/** הקונה הקליד כרטיס ולחץ "תשלום". מחזיר את הסטטוס החדש. */
export function sandboxPay(db, ref, card) {
  const p = row(db, ref);
  if (!p) throw new UserError("העסקה לא נמצאה", 404);
  if (p.status !== "pending") return p.status;
  const digits = String(card ?? "").replace(/\D/g, "");
  if (digits.length < 12) throw new UserError("מספר כרטיס לא תקין");
  const status = digits.startsWith("4000") ? "failed" : "paid";
  db.prepare("UPDATE pay_sandbox SET status = ?, card_last4 = ?, paid_at = ? WHERE ref = ?").run(status, digits.slice(-4), clock.iso(), ref);
  return status;
}
