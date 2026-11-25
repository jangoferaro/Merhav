// מתאמים לחיבור חשבונות חיצוניים של ג׳וקרים: מוזיקה (טעם) ורשתות (קהל).
// כל מתאם מגדיר איך מתחברים (OAuth רשמי של הספק, בלי סיסמאות) ומה מושכים.
// fetch(token, fetchImpl) מחזיר: { externalId, handle, url, metrics: {followers, ...}, artists: [], genres: [] }
//
// מגבלות ידועות (נבדק בנובמבר 2026, לבדוק שוב לפני השקה):
//  Spotify   — במצב פיתוח עד 5 משתמשים. הרחבה דורשת אישור של Spotify (עסק רשום ו-250 אלף משתמשים פעילים בחודש).
//  Instagram — רק חשבון מקצועי (Business או Creator). אישור אפליקציה ב-Meta לפני שימוש ציבורי.
//  TikTok    — מספר עוקבים דורש את ההרשאה user.info.stats ואישור של TikTok.
//  YouTube   — הרשאה רגישה (youtube.readonly): עד 100 משתמשי בדיקה עד אימות של Google.
//  Facebook  — רק עמודים (Pages) שהמשתמש מנהל. לפרופיל אישי אין מספר עוקבים ב-API.
//  Apple     — דרך MusicKit JS בדפדפן. דורש מנוי Apple Developer (99$ לשנה) ומפתח MusicKit.
import crypto from "node:crypto";
import { clock, UserError } from "../util.js";

const env = (k) => process.env[k] || "";
const bearer = (t) => ({ authorization: `Bearer ${t}` });

async function getJson(fetchImpl, url, headers = {}) {
  const res = await fetchImpl(url, { headers: { accept: "application/json", ...headers } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) {
    const e = new Error(`unauthorized ${res.status}`);
    e.unauthorized = true;
    throw e;
  }
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

export const PROVIDERS = {
  spotify: {
    label: "Spotify",
    kind: "music",
    envKeys: ["SPOTIFY_CLIENT_ID", "SPOTIFY_CLIENT_SECRET"],
    note: "אמנים וסגנונות שאת/ה מאזין/ה להם הכי הרבה",
    authUrl: "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    scopes: ["user-top-read", "user-follow-read"],
    clientId: () => env("SPOTIFY_CLIENT_ID"),
    clientSecret: () => env("SPOTIFY_CLIENT_SECRET"),
    pkce: true,
    tokenAuth: "basic",
    async fetch(token, f) {
      const me = await getJson(f, "https://api.spotify.com/v1/me", bearer(token));
      const top = await getJson(f, "https://api.spotify.com/v1/me/top/artists?limit=30&time_range=medium_term", bearer(token));
      const items = top.items ?? [];
      return {
        externalId: me.id, handle: me.display_name || me.id, url: me.external_urls?.spotify ?? "",
        metrics: {}, artists: items.map((a) => a.name), genres: items.flatMap((a) => a.genres ?? []),
      };
    },
  },

  apple: {
    label: "Apple Music",
    kind: "music",
    envKeys: ["APPLE_MUSIC_TEAM_ID", "APPLE_MUSIC_KEY_ID", "APPLE_MUSIC_PRIVATE_KEY"],
    note: "האמנים בספרייה ומה שאת/ה שומע/ת לאחרונה",
    clientSide: true, // ההרשאה ניתנת ב-MusicKit JS בדפדפן, לא בהפניה
    async fetch(userToken, f) {
      const h = { authorization: `Bearer ${appleDeveloperToken()}`, "music-user-token": userToken };
      const lib = await getJson(f, "https://api.music.apple.com/v1/me/library/artists?limit=100", h);
      let rotation = { data: [] };
      try {
        rotation = await getJson(f, "https://api.music.apple.com/v1/me/history/heavy-rotation?limit=10", h);
      } catch (e) {
        if (e.unauthorized) throw e;
      }
      return {
        externalId: null, handle: "Apple Music", url: "",
        metrics: {},
        artists: (lib.data ?? []).map((a) => a.attributes?.name).filter(Boolean),
        genres: (rotation.data ?? []).flatMap((x) => x.attributes?.genreNames ?? []),
      };
    },
  },

  instagram: {
    label: "Instagram",
    kind: "social",
    envKeys: ["INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"],
    note: "רק חשבון מקצועי (עסקי או יוצר). מספר העוקבים מאומת",
    authUrl: "https://www.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    scopes: ["instagram_business_basic"],
    scopeSep: ",",
    clientId: () => env("INSTAGRAM_CLIENT_ID"),
    clientSecret: () => env("INSTAGRAM_CLIENT_SECRET"),
    tokenAuth: "body",
    /** הטוקן הקצר מוחלף בטוקן ל-60 יום, שמתחדש בכל סנכרון */
    async afterToken(t, f) {
      const long = await getJson(f, `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(env("INSTAGRAM_CLIENT_SECRET"))}&access_token=${encodeURIComponent(t.access_token)}`);
      return { access_token: long.access_token, expires_in: long.expires_in, refresh_token: null };
    },
    async refresh(acc, f) {
      const r = await getJson(f, `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(acc.access)}`);
      return { access_token: r.access_token, expires_in: r.expires_in };
    },
    async fetch(token, f) {
      const me = await getJson(f, `https://graph.instagram.com/me?fields=user_id,username,followers_count,media_count&access_token=${encodeURIComponent(token)}`);
      return {
        externalId: String(me.user_id ?? me.id ?? ""), handle: me.username ? `@${me.username}` : "", url: me.username ? `https://instagram.com/${me.username}` : "",
        metrics: { followers: me.followers_count, posts: me.media_count }, artists: [], genres: [],
      };
    },
  },

  tiktok: {
    label: "TikTok",
    kind: "social",
    envKeys: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    note: "עוקבים ולייקים, מאומתים",
    authUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["user.info.basic", "user.info.profile", "user.info.stats"],
    scopeSep: ",",
    clientParam: "client_key",
    clientId: () => env("TIKTOK_CLIENT_KEY"),
    clientSecret: () => env("TIKTOK_CLIENT_SECRET"),
    tokenAuth: "body",
    async fetch(token, f) {
      const r = await getJson(f, "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username,profile_deep_link,follower_count,likes_count,video_count", bearer(token));
      const u = r.data?.user ?? {};
      return {
        externalId: u.open_id, handle: u.username ? `@${u.username}` : u.display_name ?? "", url: u.profile_deep_link ?? "",
        metrics: { followers: u.follower_count, likes: u.likes_count, videos: u.video_count }, artists: [], genres: [],
      };
    },
  },

  youtube: {
    label: "YouTube",
    kind: "social",
    envKeys: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    note: "מנויים לערוץ, מאומתים",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
    extraAuth: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    clientId: () => env("GOOGLE_CLIENT_ID"),
    clientSecret: () => env("GOOGLE_CLIENT_SECRET"),
    pkce: true,
    tokenAuth: "body",
    async fetch(token, f) {
      const r = await getJson(f, "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true", bearer(token));
      const ch = r.items?.[0];
      if (!ch) return { externalId: null, handle: "", url: "", metrics: {}, artists: [], genres: [], empty: "לחשבון הזה אין ערוץ YouTube" };
      return {
        externalId: ch.id, handle: ch.snippet?.customUrl || ch.snippet?.title || "", url: `https://youtube.com/channel/${ch.id}`,
        metrics: { followers: ch.statistics?.hiddenSubscriberCount ? null : Number(ch.statistics?.subscriberCount ?? 0), videos: Number(ch.statistics?.videoCount ?? 0) },
        artists: [], genres: [],
      };
    },
  },

  facebook: {
    label: "Facebook",
    kind: "social",
    envKeys: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET"],
    note: "עמוד (Page) שאת/ה מנהל/ת. לפרופיל אישי אין מספר עוקבים",
    authUrl: "https://www.facebook.com/v21.0/dialog/oauth",
    tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
    scopes: ["pages_show_list", "pages_read_engagement"],
    scopeSep: ",",
    clientId: () => env("FACEBOOK_APP_ID"),
    clientSecret: () => env("FACEBOOK_APP_SECRET"),
    tokenAuth: "body",
    async fetch(token, f) {
      const r = await getJson(f, `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,link,followers_count,fan_count&access_token=${encodeURIComponent(token)}`);
      const pages = r.data ?? [];
      if (!pages.length) return { externalId: null, handle: "", url: "", metrics: {}, artists: [], genres: [], empty: "לא נמצא עמוד שאת/ה מנהל/ת" };
      const p = pages.reduce((a, b) => ((b.followers_count ?? b.fan_count ?? 0) > (a.followers_count ?? a.fan_count ?? 0) ? b : a));
      return {
        externalId: p.id, handle: p.name, url: p.link ?? `https://facebook.com/${p.id}`,
        metrics: { followers: p.followers_count ?? p.fan_count ?? null }, artists: [], genres: [],
      };
    },
  },
};

export const providerOr404 = (name) => {
  const p = PROVIDERS[name];
  if (!p) throw new UserError("החיבור לא קיים", 404);
  return p;
};

export const configured = (p) => p.envKeys.every((k) => process.env[k]);
export const missingEnv = (p) => p.envKeys.filter((k) => !process.env[k]);

// ---------- Apple: טוקן מפתח (JWT חתום ES256) ----------

let appleCache = null;
/** טוקן מפתח ל-Apple Music. תקף עד 180 יום; מתחדש פעם ביום */
export function appleDeveloperToken() {
  const now = Math.floor(clock.now().getTime() / 1000);
  if (appleCache && appleCache.exp - now > 86400 * 30) return appleCache.token;
  const key = env("APPLE_MUSIC_PRIVATE_KEY").replace(/\\n/g, "\n");
  if (!key) throw new UserError("Apple Music לא מוגדר");
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const exp = now + 86400 * 150;
  const head = b64({ alg: "ES256", kid: env("APPLE_MUSIC_KEY_ID") });
  const body = b64({ iss: env("APPLE_MUSIC_TEAM_ID"), iat: now, exp });
  const sig = crypto.sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  appleCache = { token: `${head}.${body}.${sig}`, exp };
  return appleCache.token;
}
export const _resetAppleCache = () => (appleCache = null);

// ---------- סגנונות: מהשפה של הספקים לשפה שלנו ----------

const GENRE_MAP = [
  [/indie/i, "אינדי"], [/alt/i, "אלטרנטיבי"], [/\bpop\b|pop$|^pop/i, "פופ"], [/rock/i, "רוק"], [/folk|singer-songwriter|acoustic/i, "פולק"],
  [/jazz/i, "ג'אז"], [/hip.?hop|rap|trap/i, "היפ הופ"], [/electro|house|techno|edm|dance|trance|drum.?and.?bass/i, "אלקטרוני"],
  [/mediterran|israeli|hebrew/i, "ים תיכוני"], [/mizrahi|mizrachi|middle east/i, "מזרחית"], [/punk/i, "פאנק"], [/metal/i, "מטאל"],
  [/r&b|rnb|soul|funk/i, "R&B"], [/classical|orchestra|opera/i, "קלאסי"], [/comedy|stand.?up/i, "סטנדאפ"],
];

/** ממיר סגנונות של ספק (באנגלית, מפורטים) לרשימת הסגנונות שלנו, לפי שכיחות */
export function mapGenres(raw) {
  const count = new Map();
  for (const g of raw) {
    for (const [re, he] of GENRE_MAP) if (re.test(g)) count.set(he, (count.get(he) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
}
