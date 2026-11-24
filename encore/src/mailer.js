// שליחת קוד כניסה. בפיתוח: מודפס ליומן ומוצג על המסך.
// בייצור: דרך Resend (או כל ספק אחר — מחליפים רק את הפונקציה הזו).
import { config } from "./util.js";

export async function sendLoginCode(email, code) {
  if (process.env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || "Jocares <login@jocares.example>",
        to: email,
        subject: `הקוד שלך ל-Jocares: ${code}`,
        text: `הקוד שלך: ${code}\nהוא בתוקף ל-10 דקות. אם לא ביקשת אותו, אפשר להתעלם מההודעה.`,
      }),
    });
    if (!res.ok) throw new Error(`mail send failed: ${res.status}`);
    return { sent: true };
  }
  if (!config.showLoginCodes) throw new Error("RESEND_API_KEY חסר — אי אפשר לשלוח קודי כניסה");
  console.log(`[dev] login code for ${email}: ${code}`);
  return { sent: false, devCode: code };
}

/** הכרטיסים לקונה. בלי ספק דואר: נרשם ביומן (הקונה רואה את הכרטיסים גם על המסך מיד אחרי התשלום). */
export async function sendTickets(email, { name, show, url, qty }) {
  const subject = `הכרטיסים שלך: ${show}`;
  const body = `היי ${name},\n\n${qty > 1 ? `${qty} הכרטיסים שלך` : "הכרטיס שלך"} ל${show} מחכים כאן:\n${url}\n\nבכניסה מציגים את הקוד מהטלפון. אין צורך להדפיס.\n\nJocares`;
  if (process.env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM || "Jocares <tickets@jocares.example>", to: email, subject, text: body }),
    });
    if (!res.ok) throw new Error(`mail send failed: ${res.status}`);
    return { sent: true };
  }
  if (!config.isProd || config.isStaging) console.log(`[dev] tickets for ${email}: ${url}`);
  return { sent: false };
}
