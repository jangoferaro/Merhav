// פרופיל ג׳וקר: זהות, טעם מוזיקלי, שלושה ממדי ערך, קלף ציבורי, התאמה והזמנות ישירות מאמנים.
// עקרונות (מתוך האפיון): אין חובה להיות משפיען, כל שדה רשות, נתון חסר הוא לא אפס,
// בלי אחוזי התאמה "מדעיים", בלי דירוג ציבורי, וג׳וקר חדש מקבל הזדמנויות גם בלי היסטוריה.
import crypto from "node:crypto";
import { insert, tx } from "../db.js";
import { clock, money, text, UserError } from "../util.js";
import { validImageRef } from "../media.js";
import { audit, getUser, notify, publicName } from "./identity.js";
import { getCampaign, split } from "./campaigns.js";
import { getOrCreateLink } from "./referrals.js";
import { musicFromConnections, verifiedSocial } from "./connections.js";

export const GENRES = ["אינדי", "פופ", "רוק", "אלטרנטיבי", "פולק", "ג'אז", "היפ הופ", "אלקטרוני", "ים תיכוני", "מזרחית", "פאנק", "מטאל", "R&B", "קלאסי", "סטנדאפ", "תיאטרון"];
export const SKILLS = {
  share: "שיתוף בוואטסאפ ובקבוצות",
  community: "יש לי קהילה או ערוץ",
  content: "יצירת תוכן (סרטונים, תמונות)",
  events: "מגיע/ה להרבה הופעות",
  photo: "צילום",
};
export const SOCIAL_PLATFORMS = ["Instagram", "TikTok", "YouTube", "Facebook", "Telegram"];
export const CARD_FIELDS = {
  genres: "הטעם המוזיקלי",
  city: "אזור",
  bio: "כמה מילים עליי",
  tickets: "כמה כרטיסים מכרתי",
  artists: "כמה אמנים קידמתי",
  social: "עוקבים (הצהרה עצמית)",
};
export const INVITE_KINDS = {
  promote: "קידום ההופעה",
  content: "יצירת תוכן להופעה",
  ongoing: "שיתוף פעולה מתמשך",
};

const csv = (v, allowed = null, max = 12) => {
  const items = [].concat(v ?? []).flatMap((x) => String(x).split(",")).map((x) => x.trim()).filter(Boolean);
  const uniq = [...new Set(allowed ? items.filter((x) => allowed.includes(x)) : items.map((x) => x.slice(0, 40)))];
  return uniq.slice(0, max).join(",");
};
export const list = (s) => String(s ?? "").split(",").filter(Boolean);

export const getJoker = (db, userId) => db.prepare("SELECT * FROM joker_profiles WHERE user_id = ?").get(userId);
export const jokerByPublicId = (db, pid) => db.prepare("SELECT * FROM joker_profiles WHERE public_id = ?").get(String(pid ?? "").toUpperCase());

function newPublicId(db) {
  for (;;) {
    const n = String(crypto.randomInt(10000, 99999));
    if (!jokerByPublicId(db, n)) return n;
  }
}

/** יצירה או עדכון. רק השם חובה. */
export function saveJoker(db, user, input) {
  const now = clock.iso();
  const followers = String(input.social_followers ?? "").trim() === "" ? null : Number(String(input.social_followers).replace(/[^\d]/g, ""));
  if (followers !== null && (!Number.isInteger(followers) || followers > 100_000_000)) throw new UserError("מספר העוקבים לא תקין");
  const socialUrl = String(input.social_url ?? "").trim();
  if (socialUrl && !/^https:\/\/[^\s<>"']+$/.test(socialUrl)) throw new UserError("הקישור לפרופיל צריך להתחיל ב-https://");
  const row = {
    nickname: text(input.nickname || user.name, "שם או כינוי", { max: 40 }),
    image_url: validImageRef(input.image_url) || "",
    city: text(input.city, "אזור", { max: 40, required: false }),
    languages: csv(input.languages, null, 5),
    bio: text(input.bio, "כמה מילים עליך", { max: 280, required: false }),
    genres: csv(input.genres, GENRES),
    fav_artists: csv(input.fav_artists, null, 10),
    skills: csv(input.skills, Object.keys(SKILLS)),
    social_platform: SOCIAL_PLATFORMS.includes(input.social_platform) ? input.social_platform : "",
    social_url: socialUrl.slice(0, 300),
    social_followers: followers,
  };
  const existing = getJoker(db, user.id);
  if (existing) {
    const sets = Object.keys(row).map((k) => `${k} = :${k}`).join(", ");
    db.prepare(`UPDATE joker_profiles SET ${sets}, updated_at = :now WHERE user_id = :uid`).run({ ...row, now, uid: user.id });
  } else {
    insert(db, "joker_profiles", { user_id: user.id, public_id: newPublicId(db), ...row, created_at: now, updated_at: now });
    audit(db, user.id, "joker.profile_created", "user", user.id);
  }
  return getJoker(db, user.id);
}

/** מוסיף לטעם הידני את הסגנונות שזוהו מחיבור (המשתמש בוחר, לא אוטומטית) */
export function adoptGenres(db, user, genres) {
  const j = ensureJoker(db, user);
  const merged = csv([...list(j.genres), ...[].concat(genres ?? [])], GENRES);
  db.prepare("UPDATE joker_profiles SET genres = ?, updated_at = ? WHERE user_id = ?").run(merged, clock.iso(), user.id);
}

/** פרופיל מינימלי אוטומטי, כדי שאפשר יהיה להזמין ולהתאים גם מי שלא מילא כלום */
export function ensureJoker(db, user) {
  return getJoker(db, user.id) ?? saveJoker(db, user, { nickname: publicName(user) });
}

export function setCard(db, user, { publish, fields }) {
  ensureJoker(db, user);
  const f = [].concat(fields ?? []).filter((k) => k in CARD_FIELDS).join(",");
  db.prepare("UPDATE joker_profiles SET card_public = ?, card_fields = ?, updated_at = ? WHERE user_id = ?").run(publish === "1" ? 1 : 0, f, clock.iso(), user.id);
}

export function setInvitationsOn(db, user, on) {
  ensureJoker(db, user);
  db.prepare("UPDATE joker_profiles SET invitations_on = ?, updated_at = ? WHERE user_id = ?").run(on ? 1 : 0, clock.iso(), user.id);
}

// ---------- שלושה ממדי ערך (נתונים פנימיים אמיתיים בלבד) ----------

export function powers(db, userId) {
  const sell = db
    .prepare(
      `SELECT COALESCE(SUM(MIN(o.rewarded_qty, o.qty - o.refunded_qty)), 0) AS tickets,
              COUNT(DISTINCT c.artist_id) AS artists,
              COALESCE(SUM(o.refunded_qty), 0) AS refunded
         FROM orders o JOIN referral_links l ON l.id = o.link_id JOIN campaigns c ON c.id = o.campaign_id
        WHERE l.promoter_id = ? AND o.cancelled = 0 AND o.attribution = 'ok'`
    )
    .get(userId);
  const promoted = db.prepare("SELECT COUNT(*) n FROM referral_links WHERE promoter_id = ?").get(userId).n;
  const creative = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM creator_portfolio WHERE user_id = ?) AS portfolio,
              (SELECT COUNT(*) FROM service_orders WHERE creator_id = ? AND status = 'completed') AS completed,
              (SELECT COUNT(*) FROM service_orders WHERE creator_id = ? AND status = 'completed' AND completed_at <= due_at) AS on_time`
    )
    .get(userId, userId, userId);
  const byGenre = db
    .prepare(
      `SELECT e.genre, COALESCE(SUM(MIN(o.rewarded_qty, o.qty - o.refunded_qty)), 0) AS tickets
         FROM orders o JOIN referral_links l ON l.id = o.link_id JOIN campaigns c ON c.id = o.campaign_id JOIN events e ON e.id = c.event_id
        WHERE l.promoter_id = ? AND o.cancelled = 0 AND o.attribution = 'ok' AND e.genre != '' GROUP BY e.genre ORDER BY tickets DESC`
    )
    .all(userId);
  return { ...sell, promoted, ...creative, byGenre };
}

/**
 * הפרופיל כפי שההתאמה והתצוגה רואות אותו: טעם ידני + טעם מחיבורים,
 * ועוקבים מאומתים מחיבור (עדיפות) או הצהרה עצמית.
 */
export function enrich(db, j) {
  const music = musicFromConnections(db, j.user_id);
  const v = verifiedSocial(db, j.user_id);
  return {
    ...j,
    allGenres: [...new Set([...list(j.genres), ...music.genres])],
    syncedGenres: music.genres, syncedArtists: music.artists, musicSources: music.sources,
    followers: v ? v.value : j.social_followers,
    followersVerified: !!v,
    followersSource: v ? v.label : j.social_platform,
    followersUrl: v ? v.profile_url : j.social_url,
    followersAt: v ? v.measured_at : null,
    verified: v,
  };
}

// ---------- התאמה ----------

const norm = (s) => String(s ?? "").trim().toLowerCase();
const sameCity = (a, b) => a && b && norm(a) === norm(b);

/**
 * התאמה מבוססת חוקים (משקלים מהאפיון: טעם 35, חברתי 25, מכירות 25, גיאוגרפיה 15).
 * הציון משמש רק למיון. למשתמש מוצג הסבר קצר במילים, לא אחוז.
 * נתון חסר לא נחשב אפס: מי שלא הצהיר על עוקבים מקבל ציון ממוצע ברכיב החברתי.
 */
export function matchScore(joker, campaign, p) {
  const genres = joker.allGenres ?? list(joker.genres);
  const taste = campaign.genre && genres.length ? (genres.includes(campaign.genre) ? 1 : 0.2) : 0.5;
  const f = joker.followers !== undefined ? joker.followers : joker.social_followers;
  const social = f == null ? 0.4 : Math.min(1, Math.log10(1 + f) / 5);
  const selling = Math.min(1, Math.log10(1 + (p?.tickets ?? 0)) / 2);
  const geo = campaign.city && joker.city ? (sameCity(campaign.city, joker.city) ? 1 : 0) : 0.5;
  return 0.35 * taste + 0.25 * social + 0.25 * selling + 0.15 * geo;
}

export function matchReasons(joker, campaign, p) {
  const out = [];
  if (campaign.genre && (joker.allGenres ?? list(joker.genres)).includes(campaign.genre)) out.push(`אוהב/ת ${campaign.genre}${joker.syncedGenres?.includes(campaign.genre) && !list(joker.genres).includes(campaign.genre) ? ` (לפי ${joker.musicSources.join(", ")})` : ""}`);
  if (sameCity(campaign.city, joker.city)) out.push(`גר/ה ב${joker.city}`);
  if (p?.tickets) out.push(p.tickets === 1 ? "מכר/ה כרטיס אחד דרכנו" : `מכר/ה ${p.tickets} כרטיסים דרכנו`);
  const g = p?.byGenre?.find((x) => x.genre === campaign.genre);
  if (g?.tickets) out.push(`${g.tickets} מהם ל${g.genre}`);
  if (p?.completed) out.push(`${p.completed} עבודות תוכן שהושלמו`);
  if (!out.length) out.push("חדש/ה ב-JoCares");
  return out;
}

/** ג׳וקרים לאמן: מותאמים להופעה, רק מי שפתוח להזמנות, ותמיד כמה חדשים (כדי לא להעדיף רק את המוכרים) */
export function jokersForCampaign(db, campaign, { limit = 12 } = {}) {
  const owners = db.prepare("SELECT user_id FROM artist_members WHERE artist_id = ?").all(campaign.artist_id).map((r) => r.user_id);
  const rows = db
    .prepare("SELECT j.* FROM joker_profiles j JOIN users u ON u.id = j.user_id WHERE j.invitations_on = 1 AND u.frozen_at IS NULL")
    .all()
    .filter((j) => !owners.includes(j.user_id))
    .map((j) => enrich(db, j));
  const scored = rows.map((j) => {
    const p = powers(db, j.user_id);
    return { j, p, score: matchScore(j, campaign, p), reasons: matchReasons(j, campaign, p), isNew: !p.tickets };
  });
  scored.sort((a, b) => b.score - a.score);
  const experienced = scored.filter((x) => !x.isNew).slice(0, limit - 3);
  const fresh = scored.filter((x) => x.isNew).slice(0, limit - experienced.length);
  const invited = new Map(
    db.prepare("SELECT joker_id, status FROM joker_invitations WHERE campaign_id = ? ORDER BY id").all(campaign.id).map((r) => [r.joker_id, r.status])
  );
  const linked = new Set(db.prepare("SELECT promoter_id FROM referral_links WHERE campaign_id = ?").all(campaign.id).map((r) => r.promoter_id));
  return [...experienced, ...fresh].map((x) => ({ ...x, invitation: invited.get(x.j.user_id) ?? null, promoting: linked.has(x.j.user_id) }));
}

/** הופעות לג׳וקר, עם הסבר קצר למה */
export function showsForJoker(db, joker, shows, { limit = 4 } = {}) {
  const genres = joker?.allGenres ?? list(joker?.genres);
  const ranked = shows.map((c) => {
    const why = [];
    if (c.genre && genres.includes(c.genre)) why.push(`כי בחרת ${c.genre}`);
    if (joker?.city && sameCity(c.city, joker.city)) why.push(`ב${c.city}, קרוב אליך`);
    return { c, why, score: why.length };
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, limit).map((r) => ({ ...r.c, why: r.why.join(" · ") || "הופעה חדשה במרקטפלייס" }));
}

// ---------- הזמנות ישירות ----------

/**
 * אמן מזמין ג׳וקר. תגמול מוגדל (bonus) מתווסף לתגמול הרגיל, רק לג׳וקר הזה, ומשולם על ידי האמן.
 * חייב להשאיר לאמן משהו מכל כרטיס, גם במחיר המוקדם.
 */
export function inviteJoker(db, artistUser, campaignId, { joker_id, kind, bonus, message }) {
  return tx(db, () => {
    const c = getCampaign(db, campaignId);
    if (!c || !["active", "paused"].includes(c.status)) throw new UserError("ההופעה לא פתוחה לקידום");
    const j = getJoker(db, Number(joker_id));
    if (!j) throw new UserError("הג׳וקר לא נמצא");
    if (!j.invitations_on) throw new UserError("הג׳וקר לא מקבל הזמנות כרגע");
    if (j.user_id === artistUser.id) throw new UserError("אי אפשר להזמין את עצמך");
    const k = INVITE_KINDS[kind] ? kind : "promote";
    const b = Math.round(Number(String(bonus ?? "0").trim() || 0) * 100);
    if (!Number.isInteger(b) || b < 0) throw new UserError("התגמול המוגדל לא תקין");
    for (const price of [c.price_agorot, c.early_price_agorot].filter(Boolean)) {
      if (split(price, c.reward_agorot + b).artist < 0) throw new UserError("התגמול המוגדל גבוה מדי: לא נשאר לך כלום מהכרטיס");
    }
    if (db.prepare("SELECT 1 FROM joker_invitations WHERE campaign_id = ? AND joker_id = ? AND status = 'open'").get(c.id, j.user_id)) {
      throw new UserError("כבר שלחת לו/ה הזמנה להופעה הזאת");
    }
    const id = insert(db, "joker_invitations", {
      campaign_id: c.id, joker_id: j.user_id, artist_user_id: artistUser.id, kind: k, bonus_agorot: b,
      message: text(message, "הודעה", { max: 300, required: false }), created_at: clock.iso(),
    });
    const per = c.reward_agorot + b;
    notify(db, j.user_id, `${c.artist_name} מזמינים אותך: ${INVITE_KINDS[k]} של "${c.title}"${k === "promote" ? `, ${money(per)} לכרטיס` : ""}.`, "/me/profile#invitations", { email: true });
    audit(db, artistUser.id, "joker.invited", "campaign", c.id, { joker: j.user_id, kind: k, bonus: b });
    return id;
  });
}

export const invitationsFor = (db, userId) =>
  db.prepare(
    `SELECT i.*, e.title, e.starts_at, e.city, COALESCE(NULLIF(e.performer, ''), a.name) AS artist_name, t.reward_agorot, c.status AS campaign_status
       FROM joker_invitations i JOIN campaigns c ON c.id = i.campaign_id JOIN events e ON e.id = c.event_id JOIN artists a ON a.id = c.artist_id
       JOIN campaign_terms t ON t.campaign_id = c.id AND t.version = (SELECT MAX(version) FROM campaign_terms WHERE campaign_id = c.id)
      WHERE i.joker_id = ? ORDER BY i.status = 'open' DESC, i.id DESC LIMIT 50`
  ).all(userId);

export function decideInvitation(db, user, invitationId, accept) {
  return tx(db, () => {
    const i = db.prepare("SELECT * FROM joker_invitations WHERE id = ? AND joker_id = ?").get(Number(invitationId), user.id);
    if (!i || i.status !== "open") throw new UserError("ההזמנה לא פתוחה");
    const c = getCampaign(db, i.campaign_id);
    db.prepare("UPDATE joker_invitations SET status = ?, decided_at = ? WHERE id = ?").run(accept ? "accepted" : "declined", clock.iso(), i.id);
    if (accept) {
      const link = getOrCreateLink(db, user, c.id);
      if (i.bonus_agorot > link.bonus_agorot) db.prepare("UPDATE referral_links SET bonus_agorot = ? WHERE id = ?").run(i.bonus_agorot, link.id);
    }
    notify(db, i.artist_user_id, `${publicName(user)} ${accept ? "קיבל/ה" : "לא יכול/ה לקבל"} את ההזמנה ל"${c.title}".`, `/artist/c/${c.id}/jokers`);
    audit(db, user.id, accept ? "joker.invitation_accepted" : "joker.invitation_declined", "campaign", c.id, { invitation: i.id });
    return c;
  });
}

/** מה מותר להציג לאחרים (קלף ציבורי ותצוגת אמן). רווחים, פרטי תשלום ופרטי קשר לעולם לא. */
export function publicView(j0, p, { forArtist = false, db = null } = {}) {
  const j = j0.allGenres || !db ? j0 : enrich(db, j0);
  const f = new Set(list(j.card_fields));
  const show = (k) => forArtist || f.has(k);
  return {
    public_id: j.public_id,
    nickname: j.nickname,
    image_url: j.image_url,
    genres: show("genres") ? (j.allGenres ?? list(j.genres)) : [],
    city: show("city") ? j.city : "",
    bio: show("bio") ? j.bio : "",
    tickets: f.has("tickets") || forArtist ? p.tickets : null,
    artists: f.has("artists") || forArtist ? p.artists : null,
    social: (f.has("social") || forArtist) && (j.followers ?? j.social_followers) != null
      ? { platform: j.followersSource ?? j.social_platform, followers: j.followers ?? j.social_followers, url: j.followersUrl ?? j.social_url, verified: !!j.followersVerified, at: j.followersAt ?? null }
      : null,
    skills: forArtist ? list(j.skills) : [],
  };
}
