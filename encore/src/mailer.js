// שליחת מייל ו-SMS. הספק נבחר לפי המפתח שמוגדר בסביבה:
//   מייל: BREVO_API_KEY (Brevo) או RESEND_API_KEY (Resend). שולח: MAIL_FROM, למשל "JoCares <hello@jocares.co.il>"
//   SMS:  TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM (מספר או שם שולח, או MessagingServiceSid שמתחיל ב-MG)
// בלי מפתח: בפיתוח ובבדיקות מודפס ליומן (וקוד הכניסה מוצג על המסך).
import { config } from "./util.js";

const fromHeader = () => process.env.MAIL_FROM || "JoCares <hello@jocares.example>";

function parseFrom(v) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(v);
  return m ? { name: m[1] || "JoCares", email: m[2] } : { name: "JoCares", email: v.trim() };
}

export const mailEnabled = () => !!(process.env.BREVO_API_KEY || process.env.RESEND_API_KEY);
export const smsEnabled = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);

/** שליחת מייל טקסט. מחזיר true אם נשלח דרך ספק, false אם אין ספק מוגדר. */
export async function sendMail({ to, subject, text }, fetchImpl = fetch) {
  if (process.env.BREVO_API_KEY) {
    const res = await fetchImpl("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: parseFrom(fromHeader()), to: [{ email: to }], subject, textContent: text }),
    });
    if (!res.ok) throw new Error(`brevo send failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return true;
  }
  if (process.env.RESEND_API_KEY) {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: fromHeader(), to, subject, text }),
    });
    if (!res.ok) throw new Error(`resend send failed: ${res.status}`);
    return true;
  }
  return false;
}

/** מספר ישראלי (050-1234567) או בינלאומי → E.164. מחזיר null אם לא נראה כמו נייד. */
export function toE164(phone) {
  const d = String(phone ?? "").replace(/[^\d+]/g, "");
  if (/^\+\d{8,15}$/.test(d)) return d;
  if (/^05\d{8}$/.test(d)) return `+972${d.slice(1)}`;
  if (/^9725\d{8}$/.test(d)) return `+${d}`;
  return null;
}

export async function sendSms(phone, body, fetchImpl = fetch) {
  const to = toE164(phone);
  if (!to || !smsEnabled()) return false;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const from = process.env.TWILIO_FROM;
  const form = new URLSearchParams({ To: to, Body: body, ...(from.startsWith("MG") ? { MessagingServiceSid: from } : { From: from }) });
  const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: { authorization: "Basic " + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"), "content-type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!res.ok) throw new Error(`twilio send failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return true;
}

export async function sendLoginCode(addr, code) {
  const sent = await sendMail({
    to: addr,
    subject: `הקוד שלך ל-JoCares: ${code}`,
    text: `הקוד שלך: ${code}\nהוא בתוקף ל-10 דקות. אם לא ביקשת אותו, אפשר להתעלם מההודעה.`,
  });
  if (sent) return { sent: true };
  if (!config.showLoginCodes) throw new Error("אין ספק מייל מוגדר (BREVO_API_KEY או RESEND_API_KEY) — אי אפשר לשלוח קודי כניסה");
  console.log(`[dev] login code for ${addr}: ${code}`);
  return { sent: false, devCode: code };
}

/** הכרטיסים לקונה: מייל, ו-SMS אם השאיר טלפון. כישלון באחד לא עוצר את השני. */
export async function sendTickets(addr, { name, show, url, qty, phone = "" }) {
  const many = qty > 1;
  const results = await Promise.allSettled([
    sendMail({
      to: addr,
      subject: `הכרטיסים שלך: ${show}`,
      text: `היי ${name},\n\n${many ? `${qty} הכרטיסים שלך` : "הכרטיס שלך"} ל${show} מחכים כאן:\n${url}\n\nבכניסה מציגים את הקוד מהטלפון. אין צורך להדפיס.\n\nJocares`,
    }),
    sendSms(phone, `${many ? "הכרטיסים שלך" : "הכרטיס שלך"} ל${show}: ${url}`),
  ]);
  for (const r of results) if (r.status === "rejected") console.error("[tickets delivery]", r.reason?.message);
  const [mail, sms] = results.map((r) => r.status === "fulfilled" && r.value);
  if (!mail && !sms && (!config.isProd || config.isStaging)) console.log(`[dev] tickets for ${addr}: ${url}`);
  return { mail, sms };
}
