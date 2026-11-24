// שכבת התשלום של הקופה. כל ספק סליקה הוא מתאם עם אותו ממשק:
//   name
//   createPayment(db, { amount, description, returnUrl, buyer }) → { ref, redirectUrl }
//        פותח עסקה אצל הספק ומחזיר לאן לשלוח את הקונה (עמוד תשלום מתארח: פרטי כרטיס לא עוברים אצלנו)
//   paymentStatus(db, ref)        → "pending" | "paid" | "failed"   (בדיקה מול הספק כשהקונה חוזר)
//   verifyNotification(raw, headers) → { ref, status }              (התראת שרת-לשרת חתומה מהספק)
//   refund(db, ref, amount)       → Promise<void>                   (זורק שגיאה אם נכשל, וננסה שוב)
// כרגע יש ספק Sandbox. ספק סליקה אמיתי עם פיצול תשלומים (הכסף לאמן, העמלה לנו) מתווסף כאן.
import { sandboxGateway } from "./sandbox.js";

const gateways = { sandbox: sandboxGateway };

export function gateway(name = process.env.PAYMENT_GATEWAY || "sandbox") {
  const g = gateways[name];
  if (!g) throw new Error(`Unknown payment gateway: ${name}`);
  return g;
}
