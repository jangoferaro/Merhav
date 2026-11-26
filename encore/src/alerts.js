// התראה למנהלים כשמשהו לא תקין: מייל לכל כתובת ב-ADMIN_EMAILS, דרך תיבת היציאה.
// אותה בעיה לא שולחת שוב יותר מפעם ב-6 שעות, ובעיה חדשה נשלחת מיד.
import { enqueue } from "./outbox.js";

export function checkAlerts(db, health, { emails = (process.env.ADMIN_EMAILS || "").split(","), base = process.env.PUBLIC_URL || "", now = new Date() } = {}) {
  if (health.ok || !health.problems?.length) return 0;
  const window = Math.floor(now.getTime() / (6 * 3600_000));
  let n = 0;
  for (const raw of emails) {
    const to = raw.trim().toLowerCase();
    if (!to.includes("@")) continue;
    for (const p of health.problems) {
      n += enqueue(db, {
        to,
        key: `alert:${p}:${window}:${to}`,
        subject: `JoCares: תקלה (${p})`,
        body: `המערכת זיהתה בעיה: ${p}\nכל הבעיות כרגע: ${health.problems.join(", ")}\n\nמצב מלא: ${base.replace(/\/$/, "")}/ops/health\nמה עושים: ops/RUNBOOK.md`,
      }) ? 1 : 0;
    }
  }
  return n;
}
