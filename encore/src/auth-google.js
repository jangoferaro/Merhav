// כניסה עם Google (OpenID Connect, Authorization Code + PKCE), בלי ספריות.
//
// הגדרה: GOOGLE_CLIENT_ID ו-GOOGLE_CLIENT_SECRET (Google Cloud Console → APIs & Services → Credentials →
// OAuth client ID מסוג Web application). Authorized redirect URI: <PUBLIC_URL>/auth/google/callback
// בלי שני המשתנים הכפתור פשוט לא מוצג.
//
// אבטחה:
//  - state אקראי בעוגייה חתומה (מונע CSRF בחזרה מ-Google)
//  - nonce שנבדק בתוך ה-id_token (מונע שימוש חוזר בטוקן)
//  - PKCE (S256)
//  - ה-id_token מתקבל ישירות מ-Google בערוץ TLS בשרת, ולכן לפי OpenID Connect Core §3.1.3.7
//    מספיק לבדוק iss, aud, exp ו-nonce. מקבלים רק מייל שמסומן email_verified.
import crypto from "node:crypto";
import { clock, hmac, randomToken, safeEqual, UserError } from "./util.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const STATE_TTL_MS = 10 * 60 * 1000;

export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/** עוגייה חתומה שמחזיקה את מה שצריך לאמת בחזרה: state, nonce, PKCE verifier, ולאן לחזור */
function sealState(obj) {
  const body = b64url(JSON.stringify(obj));
  return `${body}.${hmac(body, "google-state")}`;
}

function openState(value) {
  const [body, sig] = String(value ?? "").split(".");
  if (!body || !sig || !safeEqual(sig, hmac(body, "google-state"))) return null;
  try {
    const obj = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    return obj.exp > clock.now().getTime() ? obj : null;
  } catch {
    return null;
  }
}

/** שלב 1: לאן להפנות את הדפדפן, ומה לשמור בעוגייה */
export function startGoogleLogin({ redirectUri, next = "/" }) {
  const state = randomToken(18);
  const nonce = randomToken(18);
  const verifier = randomToken(48);
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  const cookieValue = sealState({ state, nonce, verifier, next, exp: clock.now().getTime() + STATE_TTL_MS });
  return { url: url.toString(), cookieValue };
}

/** בדיקת ה-id_token שהתקבל ישירות מנקודת הטוקן של Google */
export function checkIdToken(idToken, { nonce, clientId = process.env.GOOGLE_CLIENT_ID }) {
  const parts = String(idToken ?? "").split(".");
  if (parts.length !== 3) throw new UserError("תשובה לא תקינה מ-Google");
  let claims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new UserError("תשובה לא תקינה מ-Google");
  }
  if (!ISSUERS.includes(claims.iss)) throw new UserError("מנפיק לא מוכר");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new UserError("הטוקן לא נועד לאפליקציה הזו");
  if (!(Number(claims.exp) * 1000 > clock.now().getTime())) throw new UserError("פג תוקף הכניסה. נסו שוב.");
  if (!nonce || !safeEqual(String(claims.nonce ?? ""), nonce)) throw new UserError("הכניסה לא תקינה. נסו שוב.");
  if (!claims.email || !(claims.email_verified === true || claims.email_verified === "true")) {
    throw new UserError("החשבון ב-Google בלי מייל מאומת");
  }
  return { email: String(claims.email), name: String(claims.given_name || claims.name || ""), sub: String(claims.sub) };
}

/** שלב 2: חזרה מ-Google. מחזיר את המייל המאומת ולאן להמשיך. fetchImpl ניתן להחלפה בבדיקות. */
export async function finishGoogleLogin({ query, cookieValue, redirectUri, fetchImpl = fetch }) {
  if (query.error) throw new UserError(query.error === "access_denied" ? "הכניסה עם Google בוטלה" : "Google החזיר שגיאה");
  const saved = openState(cookieValue);
  if (!saved || !query.state || !safeEqual(String(query.state), saved.state)) {
    throw new UserError("פג תוקף ניסיון הכניסה. נסו שוב.");
  }
  if (!query.code) throw new UserError("חסר קוד מ-Google");
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: String(query.code),
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: saved.verifier,
    }).toString(),
  });
  if (!res.ok) throw new UserError("Google לא אישר את הכניסה. נסו שוב.");
  const tokens = await res.json();
  const info = checkIdToken(tokens.id_token, { nonce: saved.nonce });
  return { ...info, next: saved.next };
}

