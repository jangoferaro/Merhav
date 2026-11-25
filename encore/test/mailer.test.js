import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { sendMail, sendSms, toE164 } from "../src/mailer.js";

const env = { ...process.env };
afterEach(() => (process.env = { ...env }));
const capture = () => {
  const calls = [];
  const f = async (url, init) => (calls.push({ url, init }), { ok: true, text: async () => "" });
  return { calls, f };
};

test("Brevo: מייל נשלח עם המפתח בכותרת והשולח מפורק לשם ומייל", async () => {
  delete process.env.RESEND_API_KEY;
  process.env.BREVO_API_KEY = "test-key";
  process.env.MAIL_FROM = "Jocares <hello@jocares.co.il>";
  const { calls, f } = capture();
  assert.equal(await sendMail({ to: "a@b.com", subject: "s", text: "t" }, f), true);
  assert.equal(calls[0].url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(calls[0].init.headers["api-key"], "test-key");
  assert.deepEqual(JSON.parse(calls[0].init.body).sender, { name: "Jocares", email: "hello@jocares.co.il" });
});

test("בלי ספק מייל לא שולחים כלום", async () => {
  delete process.env.BREVO_API_KEY;
  delete process.env.RESEND_API_KEY;
  assert.equal(await sendMail({ to: "a@b.com", subject: "s", text: "t" }, () => assert.fail()), false);
});

test("Twilio: נייד ישראלי מומר לפורמט בינלאומי, ושירות הודעות (MG) נשלח בשדה הנכון", async () => {
  assert.equal(toE164("050-123-4567"), "+972501234567");
  assert.equal(toE164("03-1234567"), null);
  Object.assign(process.env, { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "MG123" });
  const { calls, f } = capture();
  assert.equal(await sendSms("0501234567", "hi", f), true);
  assert.match(calls[0].url, /Accounts\/AC1\/Messages\.json$/);
  const body = new URLSearchParams(calls[0].init.body.toString());
  assert.equal(body.get("To"), "+972501234567");
  assert.equal(body.get("MessagingServiceSid"), "MG123");
  assert.equal(await sendSms("", "hi", f), false);
});
