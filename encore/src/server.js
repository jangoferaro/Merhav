import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { clock, config, hmac, isEmail, money, normalizeEmail, safeEqual, showDate, UserError } from "./util.js";
import { cookie, isCrawler, makeCtx, rateLimit, readBody, Router, safeNext } from "./http.js";
import * as ID from "./domain/identity.js";
import * as C from "./domain/campaigns.js";
import * as R from "./domain/referrals.js";
import * as I from "./domain/ingest.js";
import * as M from "./domain/money.js";
import { extractShow } from "./domain/extract.js";
import { provider } from "./providers/index.js";
import * as Sim from "./providers/sim.js";
import * as P from "./views/public.js";
import * as ME from "./views/me.js";
import * as A from "./views/artist.js";
import * as AD from "./views/admin.js";
import * as K from "./domain/content.js";
import * as CV from "./views/content.js";
import { designPage } from "./views/design.js";
import { imageFromForm, saveMedia, serveMedia } from "./media.js";
import { finishGoogleLogin, googleEnabled, startGoogleLogin } from "./auth-google.js";
import * as CP from "./domain/coupons.js";
import * as J from "./domain/jokers.js";
import * as CN from "./domain/connections.js";
import { PROVIDERS, appleDeveloperToken, configured, missingEnv, providerOr404 } from "./connect/providers.js";
import * as JV from "./views/jokers.js";
import * as T from "./domain/tickets.js";
import * as W from "./wallet.js";
import * as DR from "./domain/door.js";
import * as DV from "./views/door.js";
import { createRequire } from "node:module";
import * as TV from "./views/tickets.js";
import { gateway } from "./payments/index.js";
import { sandboxPay, sandboxPayment } from "./payments/sandbox.js";
import { sendLoginCode, sendMail, sendTickets } from "./mailer.js";

const STATIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const STATIC_TYPES = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
// ספריית סריקת QR (jsQR, Apache-2.0): מוגשת מהשרת שלנו, כי מותר לטעון סקריפטים רק מהאתר עצמו
const JSQR = createRequire(import.meta.url).resolve("jsqr/dist/jsQR.js");
const REF_COOKIE_DAYS = config.attributionDays;

// מצב תפעולי לסוכן התחזוקה: רק ספירות ודגלים, בלי מידע אישי ובלי סכומים
export const ops = { started: Date.now(), errors: [], lastSettleAt: null, lastSettleError: null };

export function opsHealth(db) {
  const hourAgo = Date.now() - 3600_000;
  ops.errors = ops.errors.filter((t) => t > hourAgo - 23 * 3600_000);
  const n = (sql, ...a) => db.prepare(sql).get(...a).n;
  let dbOk = true;
  let issues = [];
  try {
    issues = M.reconciliationIssues(db);
  } catch {
    dbOk = false;
  }
  const now = clock.iso();
  const checks = dbOk
    ? {
        reconciliation_issues: issues.length,
        failed_refunds: n("SELECT COUNT(*) n FROM ticket_refunds WHERE status = 'failed'"),
        pending_refunds_over_1h: n("SELECT COUNT(*) n FROM ticket_refunds WHERE status = 'pending' AND created_at < ?", new Date(Date.now() - 3600_000).toISOString()),
        stale_pending_orders: n("SELECT COUNT(*) n FROM ticket_orders WHERE status = 'pending' AND expires_at < ?", new Date(Date.now() - 3600_000).toISOString()),
        connection_errors: n("SELECT COUNT(*) n FROM connected_accounts WHERE status = 'error'"),
        expired_connections: n("SELECT COUNT(*) n FROM connected_accounts WHERE status = 'expired'"),
        payouts_waiting: n("SELECT COUNT(*) n FROM payouts WHERE status = 'requested'"),
        open_disputes: n("SELECT COUNT(*) n FROM disputes WHERE status = 'open'"),
        content_disputes: n("SELECT COUNT(*) n FROM service_orders WHERE status = 'disputed'"),
        active_shows: n("SELECT COUNT(*) n FROM campaigns c JOIN events e ON e.id = c.event_id WHERE c.status IN ('active','paused','sold_out') AND e.starts_at > ?", now),
        tickets_24h: n("SELECT COALESCE(SUM(qty), 0) n FROM ticket_orders WHERE status = 'paid' AND paid_at > ?", new Date(Date.now() - 86400_000).toISOString()),
      }
    : {};
  const problems = Object.entries(checks).filter(([k, v]) => v > 0 && !["active_shows", "tickets_24h", "payouts_waiting", "expired_connections"].includes(k)).map(([k]) => k);
  if (!dbOk) problems.push("database");
  if (ops.errors.filter((t) => t > hourAgo).length > 5) problems.push("server_errors");
  if (ops.lastSettleError) problems.push("settle_failed");
  return {
    ok: problems.length === 0,
    problems,
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    uptime_min: Math.round((Date.now() - ops.started) / 60000),
    server_errors_1h: ops.errors.filter((t) => t > hourAgo).length,
    server_errors_24h: ops.errors.length,
    last_settle_at: ops.lastSettleAt,
    mail: !!(process.env.BREVO_API_KEY || process.env.RESEND_API_KEY),
    sms: !!process.env.TWILIO_ACCOUNT_SID,
    payments: process.env.PAYMENT_GATEWAY || "sandbox",
    checks,
  };
}

export function createApp(db, { baseUrl = process.env.PUBLIC_URL, fetchImpl = fetch } = {}) {
  // הספק המדומה "שולח" webhooks לאותה נקודת קליטה שספק אמיתי ישתמש בה
  Sim.setSimDeliver((raw, headers) => I.ingestWebhook(db, "sim", raw, headers));

  const r = new Router();
  const origin = (ctx) => (baseUrl || `http://${ctx.req.headers.host}`).replace(/\/$/, "");
  const opts = (ctx) =>
    ctx.user ? { unread: ID.unreadCount(db, ctx.user.id), isArtist: ID.artistsOf(db, ctx.user.id).length > 0, isCreator: !!K.getProfile(db, ctx.user.id) } : {};

  const requireUser = (ctx) => {
    if (ctx.user) return true;
    const next = ctx.req.method === "GET" ? ctx.url.pathname + ctx.url.search : "/";
    ctx.redirect(`/login?next=${encodeURIComponent(next)}`);
    return false;
  };
  const requireAdmin = (ctx) => {
    if (!ctx.user?.is_admin) throw new UserError("אין הרשאה", 404);
  };
  const campaignOr404 = (id) => {
    const c = C.getCampaign(db, id);
    if (!c) throw new UserError("ההופעה לא נמצאה", 404);
    return c;
  };
  const managed = (ctx, id) => {
    const c = campaignOr404(id);
    if (!ID.canManageArtist(db, ctx.user, c.artist_id)) throw new UserError("ההופעה לא נמצאה", 404);
    return c;
  };

  // ---------- ציבורי ----------

  // מבקר חדש מקבל דף נחיתה שמסביר; מי שמחובר מקבל את מסך הבחירה של המוצר
  r.get("/", (ctx) =>
    ctx.send(
      ctx.user
        ? P.landing(ctx, C.marketplace(db, { userId: ctx.user.id }), opts(ctx))
        : P.welcomeLanding(ctx, { shows: C.marketplace(db, {}).slice(0, 3), google: googleEnabled() }, opts(ctx))
    )
  );
  r.get("/how", (ctx) => ctx.send(P.how(ctx, opts(ctx))));
  r.get("/data-deletion", (ctx) => ctx.send(P.dataDeletion(ctx, opts(ctx))));

  r.get("/terms", (ctx) => ctx.send(P.terms(ctx, opts(ctx))));
  // מדריך הסגנון הוא כלי פנימי של הצוות: רק למנהלים
  r.get("/design", (ctx) => {
    if (!requireUser(ctx)) return;
    requireAdmin(ctx);
    ctx.send(designPage(ctx, opts(ctx)));
  });

  r.get("/shows", (ctx) => {
    const city = String(ctx.query.city ?? "").slice(0, 40);
    const when = ["week", "month"].includes(ctx.query.when) ? ctx.query.when : "";
    const shows = C.marketplace(db, { userId: ctx.user?.id, city, when });
    ctx.send(P.marketplace(ctx, { shows, cities: C.marketplaceCities(db), city, when }, opts(ctx)));
  });

  // לינק אישי: רושמים לחיצה, שומרים בעוגייה (הלחיצה האחרונה מחליפה קודמות), ומפנים לדף ההופעה
  r.get("/r/:code", (ctx) => {
    rateLimit(`click:${ctx.ip}`, 120, 60_000);
    const link = R.getLinkByCode(db, ctx.params.code);
    if (!link) throw new UserError("הלינק לא קיים", 404);
    // בוט של תצוגה מקדימה (וואטסאפ וכו'): מקבל את דף ההופעה עם התמונה, בלי שזה ייספר כלחיצה
    if (isCrawler(ctx.req)) return ctx.redirect(`/s/${link.campaign_id}?via=${encodeURIComponent(link.code)}`);
    const click = R.recordClick(db, link, ctx.vid, ctx.req.headers.referer);
    ctx.setCookie(cookie(`ref_${link.campaign_id}`, click.token, { maxAge: REF_COOKIE_DAYS * 86400 }));
    ctx.redirect(`/s/${link.campaign_id}`);
  });

  const refFor = (ctx, campaignId) => {
    const token = ctx.cookies[`ref_${campaignId}`];
    if (!token) return null;
    const row = db
      .prepare(
        `SELECT k.token, u.name, u.id AS promoter_id, l.campaign_id, l.note, p.image_url AS photo FROM referral_clicks k
           JOIN referral_links l ON l.id = k.link_id JOIN users u ON u.id = l.promoter_id
           LEFT JOIN creator_profiles p ON p.user_id = u.id WHERE k.token = ?`
      )
      .get(token);
    return row && row.campaign_id === Number(campaignId) ? row : null;
  };

  /** מי הזמין את המבקר: ג׳וקר (עם תגמול) או חבר שכבר קנה (בלי תגמול). ג׳וקר קודם. */
  const inviterFor = (ctx, c) => {
    const ref = refFor(ctx, c.id);
    if (ref && ref.promoter_id !== ctx.user?.id) {
      return { kind: "joker", name: ID.publicName({ name: ref.name }), note: ref.note, photo: ref.photo, discount: c.provider === "jocares" ? T.discountPreview(db, c, ref.token) : 0 };
    }
    const inv = T.orderByInvite(db, ctx.cookies[`with_${c.id}`]);
    if (inv && inv.campaign_id === c.id) return { kind: "friend", name: T.firstName(inv.buyer_name) };
    return null;
  };
  /** לתצוגה המקדימה בוואטסאפ: מי מזמין (מהפרמטר, כי לבוטים אין עוגיות) */
  const ogInviter = (ctx, c) => {
    if (ctx.query.via) {
      const l = R.getLinkByCode(db, ctx.query.via);
      if (l && l.campaign_id === c.id) return ID.publicName(ID.getUser(db, l.promoter_id));
    }
    if (ctx.query.with) {
      const o = T.orderByInvite(db, ctx.query.with);
      if (o && o.campaign_id === c.id) return T.firstName(o.buyer_name);
    }
    return null;
  };

  // "בואו איתי": קונה שולח לחברים. אין תגמול, רק הזמנה אישית.
  r.get("/i/:code", (ctx) => {
    const o = T.orderByInvite(db, ctx.params.code);
    if (!o) throw new UserError("הלינק לא קיים", 404);
    if (isCrawler(ctx.req)) return ctx.redirect(`/s/${o.campaign_id}?with=${encodeURIComponent(o.invite_code)}`);
    ctx.setCookie(cookie(`with_${o.campaign_id}`, o.invite_code, { maxAge: REF_COOKIE_DAYS * 86400 }));
    ctx.redirect(`/s/${o.campaign_id}`);
  });

  r.get("/s/:id", (ctx) => {
    const c = campaignOr404(ctx.params.id);
    if (c.status === "draft" && !ID.canManageArtist(db, ctx.user, c.artist_id)) throw new UserError("ההופעה לא נמצאה", 404);
    const ref = refFor(ctx, c.id);
    const link = ctx.user ? db.prepare("SELECT * FROM referral_links WHERE campaign_id = ? AND promoter_id = ?").get(c.id, ctx.user.id) : null;
    ctx.send(
      P.showPage(
        ctx,
        {
          c, link, stats: link ? R.linkStats(db, link.id) : null,
          referrer: ref && ref.promoter_id !== ctx.user?.id ? ID.publicName({ name: ref.name }) : null,
          inviter: inviterFor(ctx, c),
          ogInviter: ogInviter(ctx, c),
          price: c.provider === "jocares" ? T.priceNow(db, c) : null,
          buyable: ["active", "paused", "sold_out"].includes(c.status) && c.starts_at > clock.iso(),
          left: c.provider === "jocares" ? T.inventory(db, c).available : null,
        },
        opts(ctx)
      )
    );
  });

  // מעבר למערכת הכרטוס, עם מזהה ההפניה (אם יש) — הרוכש לא מקליד שום קוד
  r.get("/s/:id/buy", (ctx) => {
    const c = campaignOr404(ctx.params.id);
    if (c.provider === "coupon") {
      // מסלול הקופונים: אם הגיעו דרך ג׳וקר, מציגים את הקוד שלו (ומעתיקים אותו), ואז לעמוד הכרטיסים של האמן
      const ref = refFor(ctx, c.id);
      const link = ref ? db.prepare("SELECT l.coupon_code FROM referral_clicks k JOIN referral_links l ON l.id = k.link_id WHERE k.token = ?").get(ref.token) : null;
      if (!/^https?:\/\//.test(c.source_url ?? "")) throw new UserError("עמוד הכרטיסים של ההופעה לא זמין כרגע", 404);
      if (link?.coupon_code) return ctx.send(P.couponHandoff(ctx, { c, code: link.coupon_code, referrer: ID.publicName({ name: ref.name }) }, opts(ctx)));
      ctx.res.writeHead(303, { location: c.source_url });
      return ctx.res.end();
    }
    const url = provider(c.provider).checkoutUrl(c, refFor(ctx, c.id)?.token);
    if (url.startsWith("/")) return ctx.redirect(url);
    ctx.res.writeHead(303, { location: url });
    ctx.res.end();
  });

  r.get("/thanks", (ctx) => {
    const c = C.getCampaignByExternal(db, "sim", String(ctx.query.event ?? ""));
    if (!c) return ctx.redirect("/shows");
    const more = C.marketplace(db, { userId: ctx.user?.id }).filter((m) => m.id !== c.id).slice(0, 3);
    ctx.send(P.thanksPage(ctx, { c, more, followed: ctx.query.followed === "1" }, opts(ctx)));
  });

  r.post("/s/:id/follow", async (ctx) => {
    const c = campaignOr404(ctx.params.id);
    const f = await ctx.form();
    const email = normalizeEmail(f.email);
    if (!isEmail(email)) throw new UserError("מייל לא תקין");
    if (f.consent !== "on") throw new UserError("צריך לאשר קבלת עדכונים");
    db.prepare("INSERT OR IGNORE INTO follows (artist_id, email, source, created_at) VALUES (?, ?, ?, ?)").run(c.artist_id, email, `campaign:${c.id}`, clock.iso());
    ctx.redirect(`/thanks?event=${encodeURIComponent(c.external_event_id)}&followed=1`);
  });

  // ---------- מקדם ----------

  r.post("/s/:id/promote", (ctx) => {
    // מי שעוד לא מחובר: אחרי ההרשמה הוא חוזר ישר ללינק שלו להופעה הזאת
    if (!ctx.user) return ctx.redirect(`/login?next=${encodeURIComponent(`/s/${Number(ctx.params.id)}/share`)}`);
    R.getOrCreateLink(db, ctx.user, ctx.params.id);
    ctx.redirect(`/s/${ctx.params.id}/share`);
  });

  r.get("/s/:id/share", (ctx) => {
    if (!requireUser(ctx)) return;
    const c = campaignOr404(ctx.params.id);
    const link = R.getOrCreateLink(db, ctx.user, c.id);
    const url = `${origin(ctx)}/r/${link.code}`;
    const code = c.provider === "coupon" ? link.coupon_code : null;
    ctx.send(
      P.sharePage(ctx, {
        c, url, code, link, text: R.shareText(c, url, link), stats: R.linkStats(db, link.id), lastImport: code ? CP.lastImportAt(db, c.id) : null,
        assets: R.assetsOf(db, c.id), price: c.provider === "jocares" ? T.priceNow(db, c) : null,
        offer: {
          profile: K.getProfile(db, ctx.user.id),
          services: K.servicesOf(db, ctx.user.id, { activeOnly: true }),
          mine: K.myOffer(db, ctx.user.id, c.id),
          isOwner: ID.canManageArtist(db, ctx.user, c.artist_id),
        },
      }, opts(ctx))
    );
  });

  r.post("/s/:id/offer", async (ctx) => {
    if (!requireUser(ctx)) return;
    const c = campaignOr404(ctx.params.id);
    rateLimit(`offer:${ctx.user.id}`, 10, 3600_000);
    K.offerService(db, ctx.user, c.id, await ctx.form());
    ctx.redirect(`/s/${c.id}/share#offer`, "ההצעה נשלחה לאמן. אם יזמין, תקבל/י התראה.");
  });

  r.post("/s/:id/share/discount", async (ctx) => {
    if (!requireUser(ctx)) return;
    const c = campaignOr404(ctx.params.id);
    const link = R.getOrCreateLink(db, ctx.user, c.id);
    const n = R.setDiscount(db, ctx.user, link.id, (await ctx.form()).discount, c.reward_agorot);
    ctx.redirect(`/s/${c.id}/share#discount`, n ? "ההנחה נשמרה. החברים יראו אותה בדף ההופעה ובקופה." : "בלי הנחה");
  });

  r.post("/s/:id/share/note", async (ctx) => {
    if (!requireUser(ctx)) return;
    const c = campaignOr404(ctx.params.id);
    const link = R.getOrCreateLink(db, ctx.user, c.id);
    const note = R.setNote(db, ctx.user, link.id, (await ctx.form()).note);
    ctx.redirect(`/s/${c.id}/share`, note ? "נשמר. מי שייכנס דרכך יראה את זה בדף ההופעה." : "המשפט נמחק");
  });

  // QR של הלינק האישי, לסטורי ולהדפסה
  r.get("/s/:id/share/qr.svg", (ctx) => {
    if (!requireUser(ctx)) return;
    const c = campaignOr404(ctx.params.id);
    const link = R.getOrCreateLink(db, ctx.user, c.id);
    ctx.res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "private, max-age=3600" });
    ctx.res.end(T.qrSvg(`${origin(ctx)}/r/${link.code}`, { size: 600 }));
  });

  // ---------- פרופיל ג׳וקר ----------

  r.get("/me/profile", (ctx) => {
    if (!requireUser(ctx)) return;
    const j = J.enrich(db, J.ensureJoker(db, ctx.user));
    const accounts = new Map(CN.accountsOf(db, ctx.user.id).map((a) => [a.provider, a]));
    const connections = Object.entries(PROVIDERS).map(([key, p]) => ({
      key, label: p.label, kind: p.kind, note: p.note, ready: configured(p), missing: ctx.user.is_admin ? missingEnv(p) : [],
      account: accounts.get(key) ?? null, growth: accounts.get(key) ? CN.growth(db, ctx.user.id, key) : null,
    }));
    const mine = new Set(db.prepare("SELECT campaign_id FROM referral_links WHERE promoter_id = ?").all(ctx.user.id).map((r) => r.campaign_id));
    const shows = C.marketplace(db, { userId: ctx.user.id }).filter((c) => !mine.has(c.id));
    ctx.send(JV.profilePage(ctx, {
      j, p: J.powers(db, ctx.user.id), b: M.balances(db, ctx.user.id), invitations: J.invitationsFor(db, ctx.user.id),
      recs: J.showsForJoker(db, j, shows), cardUrl: `${origin(ctx)}/j/${j.public_id}`, connections,
    }, opts(ctx)));
  });

  r.post("/me/profile", async (ctx) => {
    if (!requireUser(ctx)) return;
    const f = await ctx.form();
    const current = J.getJoker(db, ctx.user.id);
    f.image_url = imageFromForm(f, { required: false }) || f.image_url || current?.image_url || "";
    J.saveJoker(db, ctx.user, f);
    ctx.redirect("/me/profile", "הפרופיל נשמר");
  });

  r.post("/me/profile/card", async (ctx) => {
    if (!requireUser(ctx)) return;
    const f = await ctx.form();
    J.setCard(db, ctx.user, f);
    ctx.redirect("/me/profile#card", f.publish === "1" ? "הקלף פורסם" : "הקלף הוסתר");
  });

  r.post("/me/profile/invitations", async (ctx) => {
    if (!requireUser(ctx)) return;
    const on = (await ctx.form()).on === "1";
    J.setInvitationsOn(db, ctx.user, on);
    ctx.redirect("/me/profile", on ? "אמנים יכולים להזמין אותך" : "ההזמנות כבויות");
  });

  r.post("/me/invitations/:id/accept", (ctx) => {
    if (!requireUser(ctx)) return;
    const c = J.decideInvitation(db, ctx.user, ctx.params.id, true);
    ctx.redirect(`/s/${c.id}/share`, "קיבלת את ההזמנה. הנה הלינק האישי שלך.");
  });

  r.post("/me/invitations/:id/decline", (ctx) => {
    if (!requireUser(ctx)) return;
    J.decideInvitation(db, ctx.user, ctx.params.id, false);
    ctx.redirect("/me/profile", "עדכנו את האמן");
  });

  // הקלף הציבורי של ג׳וקר
  r.get("/j/:pid", (ctx) => {
    const j = J.jokerByPublicId(db, ctx.params.pid);
    const own = j && ctx.user?.id === j.user_id;
    if (!j || (!j.card_public && !own)) throw new UserError("הקלף לא נמצא", 404);
    ctx.send(JV.cardPage(ctx, { v: J.publicView(j, J.powers(db, j.user_id), { db }), preview: !j.card_public }, opts(ctx)));
  });

  // ---------- חיבורים חיצוניים ----------

  const connectRedirect = (ctx, name) => `${origin(ctx)}/connect/${name}/callback`;

  r.post("/me/profile/adopt", async (ctx) => {
    if (!requireUser(ctx)) return;
    J.adoptGenres(db, ctx.user, (await ctx.form()).genres);
    ctx.redirect("/me/profile#music", "נוסף לטעם שלך");
  });

  // Apple Music: ההרשאה ניתנת בדפדפן דרך MusicKit JS
  r.get("/connect/apple", (ctx) => {
    if (!requireUser(ctx)) return;
    if (!configured(PROVIDERS.apple)) throw new UserError("Apple Music עוד לא הוגדר", 404);
    ctx.send(JV.applePage(ctx, { developerToken: appleDeveloperToken() }, opts(ctx)), 200, {
      "content-security-policy":
        "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' https://js-cdn.music.apple.com; connect-src 'self' https://*.apple.com; frame-src https://*.apple.com; form-action 'self'; frame-ancestors 'none'",
    });
  });

  r.post("/connect/apple/callback", async (ctx) => {
    if (!requireUser(ctx)) return;
    rateLimit(`connect:${ctx.user.id}`, 20, 3600_000);
    const res = await CN.connectApple(db, ctx.user, (await ctx.form()).music_user_token, fetchImpl);
    ctx.redirect("/me/profile#connections", res.ok ? "Apple Music מחובר" : { ok: false, m: "התחברנו, אבל הסנכרון נכשל. אפשר לנסות שוב." });
  });

  r.get("/connect/:provider", (ctx) => {
    if (!requireUser(ctx)) return;
    const p = providerOr404(ctx.params.provider);
    if (p.clientSide) return ctx.redirect(`/connect/${ctx.params.provider}`);
    rateLimit(`connect:${ctx.user.id}`, 20, 3600_000);
    const { url, cookieValue } = CN.startConnect(ctx.user, ctx.params.provider, { redirectUri: connectRedirect(ctx, ctx.params.provider) });
    ctx.res.writeHead(302, { location: url, "set-cookie": [cookie("cstate", cookieValue, { maxAge: 600 })] });
    ctx.res.end();
  });

  r.get("/connect/:provider/callback", async (ctx) => {
    if (!requireUser(ctx)) return;
    const name = ctx.params.provider;
    const p = providerOr404(name);
    ctx.setCookie(cookie("cstate", "", { maxAge: 0 }));
    let res;
    try {
      res = await CN.finishConnect(db, ctx.user, name, { query: ctx.query, cookieValue: ctx.cookies.cstate, redirectUri: connectRedirect(ctx, name), fetchImpl });
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      return ctx.redirect("/me/profile#connections", { ok: false, m: e.message });
    }
    ctx.redirect("/me/profile#connections", res.ok
      ? (res.account.note ? { ok: false, m: `${p.label} מחובר, אבל: ${res.account.note}` } : `${p.label} מחובר`)
      : { ok: false, m: `${p.label} מחובר, אבל הסנכרון נכשל. אפשר לנסות שוב.` });
  });

  r.post("/connect/:provider/sync", async (ctx) => {
    if (!requireUser(ctx)) return;
    const name = ctx.params.provider;
    providerOr404(name);
    rateLimit(`sync:${ctx.user.id}`, 20, 3600_000);
    const acc = CN.accountOf(db, ctx.user.id, name);
    if (!acc) throw new UserError("החשבון לא מחובר");
    const res = await CN.syncAccount(db, acc, fetchImpl);
    ctx.redirect("/me/profile#connections", res.ok ? "עודכן" : { ok: false, m: res.status === "expired" ? "ההרשאה פגה. צריך להתחבר מחדש." : "הסנכרון נכשל. נסו שוב מאוחר יותר." });
  });

  r.post("/connect/:provider/disconnect", (ctx) => {
    if (!requireUser(ctx)) return;
    CN.disconnect(db, ctx.user, ctx.params.provider);
    ctx.redirect("/me/profile#connections", "נותק. הנתונים שסונכרנו נמחקו.");
  });

  r.get("/me/sales", (ctx) => {
    if (!requireUser(ctx)) return;
    ctx.send(ME.salesPage(ctx, { rows: M.salesByShow(db, ctx.user.id), balances: M.balances(db, ctx.user.id) }, opts(ctx)));
  });

  r.post("/me/disputes", async (ctx) => {
    if (!requireUser(ctx)) return;
    M.openDispute(db, ctx.user, await ctx.form());
    ctx.redirect("/me/sales", "קיבלנו. נבדוק מול מערכת הכרטוס ונחזור אליך.");
  });

  r.get("/me/money", (ctx) => {
    if (!requireUser(ctx)) return;
    const details = M.payoutDetails(ctx.user);
    const nextRelease = db
      .prepare(
        `SELECT MIN(e.starts_at) s FROM commissions m JOIN campaigns c ON c.id = m.campaign_id JOIN events e ON e.id = c.event_id
          WHERE m.promoter_id = ? AND m.status = 'pending'`
      )
      .get(ctx.user.id).s;
    ctx.send(
      ME.moneyPage(
        ctx,
        {
          balances: M.balances(db, ctx.user.id),
          commissions: M.commissionsOf(db, ctx.user.id),
          payouts: db.prepare("SELECT * FROM payouts WHERE user_id = ? ORDER BY id DESC").all(ctx.user.id),
          details, detailsMasked: M.maskDetails(details),
          nextRelease: nextRelease ? M.availableFrom(nextRelease) : null,
        },
        opts(ctx)
      )
    );
  });

  r.post("/me/payout-details", async (ctx) => {
    if (!requireUser(ctx)) return;
    M.savePayoutDetails(db, ctx.user, await ctx.form());
    ctx.redirect("/me/money", "נשמר");
  });

  r.post("/me/payouts", async (ctx) => {
    if (!requireUser(ctx)) return;
    M.requestPayout(db, ctx.user);
    ctx.redirect("/me/money", "הבקשה התקבלה. ההעברה מתבצעת בדרך כלל תוך 5 ימי עסקים.");
  });

  r.get("/me/notifications", (ctx) => {
    if (!requireUser(ctx)) return;
    const items = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 100").all(ctx.user.id);
    const page = ME.notificationsPage(ctx, { items, notifySales: !!ctx.user.notify_sales }, opts(ctx));
    db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(clock.iso(), ctx.user.id);
    ctx.send(page);
  });

  r.post("/me/settings", async (ctx) => {
    if (!requireUser(ctx)) return;
    const f = await ctx.form();
    db.prepare("UPDATE users SET notify_sales = ? WHERE id = ?").run(f.notify_sales === "on" ? 1 : 0, ctx.user.id);
    ctx.redirect("/me/notifications", "נשמר");
  });

  // ---------- כניסה ----------

  r.get("/login", (ctx) => {
    if (ctx.user) return ctx.redirect(safeNext(ctx.query.next) || "/shows");
    ctx.send(P.loginPage(ctx, { next: safeNext(ctx.query.next), step: "email", google: googleEnabled() }, opts(ctx)));
  });

  r.post("/login", async (ctx) => {
    rateLimit(`login:${ctx.ip}`, 10, 600_000);
    const f = await ctx.form();
    const { email, code } = ID.requestLoginCode(db, f.email);
    const sent = await sendLoginCode(email, code);
    ctx.flash = sent.devCode ? { ok: true, m: "הקוד נשלח", dev: `הקוד הוא ${sent.devCode}` } : { ok: true, m: "הקוד נשלח למייל" };
    ctx.send(P.loginPage(ctx, { next: safeNext(f.next), email, step: "code" }, opts(ctx)));
  });

  r.post("/login/code", async (ctx) => {
    rateLimit(`verify:${ctx.ip}`, 30, 600_000);
    const f = await ctx.form();
    let result;
    try {
      result = ID.verifyLoginCode(db, f.email, f.code);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      ctx.flash = { ok: false, m: e.message };
      return ctx.send(P.loginPage(ctx, { next: safeNext(f.next), email: normalizeEmail(f.email), step: "code" }, opts(ctx)), e.status);
    }
    ctx.setCookie(cookie("sid", result.sessionToken, { maxAge: 60 * 86400 }));
    ID.audit(db, result.user.id, "user.login", "user", result.user.id);
    const next = safeNext(f.next) || "/shows";
    ctx.redirect(result.user.name ? next : `/welcome?next=${encodeURIComponent(next)}`);
  });

  // ---------- כניסה עם Google ----------

  const googleRedirect = (ctx) => `${origin(ctx)}/auth/google/callback`;

  r.get("/auth/google", (ctx) => {
    if (!googleEnabled()) throw new UserError("כניסה עם Google לא מוגדרת", 404);
    rateLimit(`google:${ctx.ip}`, 20, 600_000);
    const { url, cookieValue } = startGoogleLogin({ redirectUri: googleRedirect(ctx), next: safeNext(ctx.query.next) || "/shows" });
    ctx.res.writeHead(302, { location: url, "set-cookie": [cookie("g_state", cookieValue, { maxAge: 600 })] });
    ctx.res.end();
  });

  r.get("/auth/google/callback", async (ctx) => {
    if (!googleEnabled()) throw new UserError("כניסה עם Google לא מוגדרת", 404);
    ctx.setCookie(cookie("g_state", "", { maxAge: 0 }));
    let info;
    try {
      info = await finishGoogleLogin({ query: ctx.query, cookieValue: ctx.cookies.g_state, redirectUri: googleRedirect(ctx), fetchImpl });
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      return ctx.redirect("/login", { ok: false, m: e.message });
    }
    const { user, sessionToken } = ID.signInVerifiedEmail(db, info.email, { name: info.name, method: "google" });
    ctx.setCookie(cookie("sid", sessionToken, { maxAge: 60 * 86400 }));
    ID.audit(db, user.id, "user.login", "user", user.id, { method: "google" });
    const next = safeNext(info.next) || "/shows";
    ctx.redirect(user.name ? next : `/welcome?next=${encodeURIComponent(next)}`);
  });

  r.get("/welcome", (ctx) => {
    if (!requireUser(ctx)) return;
    ctx.send(P.welcomePage(ctx, { next: safeNext(ctx.query.next) || "/shows" }, opts(ctx)));
  });

  r.post("/welcome", async (ctx) => {
    if (!requireUser(ctx)) return;
    const f = await ctx.form();
    ID.setName(db, ctx.user.id, f.name);
    ctx.redirect(safeNext(f.next) || "/shows");
  });

  r.post("/logout", (ctx) => {
    if (ctx.cookies.sid) ID.endSession(db, ctx.cookies.sid);
    ctx.setCookie(cookie("sid", "", { maxAge: 0 }));
    ctx.redirect("/");
  });

  // ---------- הקופה של JoCares ----------

  const checkoutData = (ctx, c) => {
    const ref = refFor(ctx, c.id);
    const inviter = inviterFor(ctx, c);
    return { c, inv: T.inventory(db, c), price: T.priceNow(db, c), inviter, discount: inviter?.discount ?? 0, referrer: ref && ref.promoter_id !== ctx.user?.id ? ID.publicName({ name: ref.name }) : null };
  };
  const jocaresCampaign = (id) => {
    const c = campaignOr404(id);
    if (c.provider !== "jocares") throw new UserError("ההופעה לא נמכרת דרך JoCares", 404);
    return c;
  };
  const ticketsUrl = (ctx, order) => `${origin(ctx)}/tickets/${order.token}`;
  const goExternal = (ctx, url) => {
    if (url.startsWith("/")) return ctx.redirect(url);
    ctx.res.writeHead(303, { location: url });
    ctx.res.end();
  };
  /** אחרי תשלום: הכרטיסים למייל. כישלון בשליחה לא מפיל את ההזמנה (הם גם על המסך). */
  const deliverTickets = (ctx, order) => {
    const c = C.getCampaign(db, order.campaign_id);
    sendTickets(order.buyer_email, { name: order.buyer_name, show: `${c.artist_name} · ${c.title}`, url: ticketsUrl(ctx, order), qty: order.qty, phone: order.buyer_phone }).catch((e) =>
      console.error("[tickets mail]", e.message)
    );
  };

  r.get("/checkout/:id", (ctx) => {
    const c = jocaresCampaign(ctx.params.id);
    if (!T.salesOpen(c)) return ctx.redirect(`/s/${c.id}`, { ok: false, m: "המכירה להופעה הזו סגורה" });
    ctx.send(TV.checkoutPage(ctx, { ...checkoutData(ctx, c), v: { email: ctx.user?.email ?? "", name: ctx.user?.name ?? "" } }, opts(ctx)));
  });

  r.post("/checkout/:id", async (ctx) => {
    const c = jocaresCampaign(ctx.params.id);
    rateLimit(`checkout:${ctx.ip}`, 20, 600_000);
    const f = await ctx.form();
    let order;
    try {
      order = T.createOrder(db, c.id, f, { clickToken: refFor(ctx, c.id)?.token ?? null, invitedBy: ctx.cookies[`with_${c.id}`] ?? null });
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      return ctx.send(TV.checkoutPage(ctx, { ...checkoutData(ctx, c), v: f, error: e.message }, opts(ctx)), 400);
    }
    goExternal(ctx, T.startPayment(db, order, { origin: origin(ctx) }));
  });

  r.get("/checkout/return/:token", (ctx) => {
    const before = T.orderByToken(db, ctx.params.token);
    if (!before) throw new UserError("ההזמנה לא נמצאה", 404);
    const order = T.returnFromPayment(db, before);
    if (order.status === "paid" || order.status === "rejected") {
      if (before.status !== "paid" && order.status === "paid") deliverTickets(ctx, order);
      return ctx.redirect(`/tickets/${order.token}${before.status !== "paid" ? "?new=1" : ""}`);
    }
    ctx.send(TV.paymentPendingPage(ctx, { order }));
  });

  // התראת שרת-לשרת מספק התשלום (ספק אמיתי). אומתה בחתימה של הספק.
  r.post("/webhooks/pay/:gateway", async (ctx) => {
    const g = gateway(ctx.params.gateway);
    const raw = await readBody(ctx.req, 64 * 1024, { raw: true });
    const n = g.verifyNotification(raw, ctx.req.headers);
    const before = db.prepare("SELECT * FROM ticket_orders WHERE gateway = ? AND payment_ref = ?").get(g.name, n.ref);
    if (n.status === "paid") {
      const { order, fresh } = T.confirmPayment(db, g.name, n.ref);
      if (fresh && before?.status !== "paid") deliverTickets(ctx, order);
    } else if (n.status === "failed") T.failPayment(db, g.name, n.ref);
    ctx.json({ ok: true });
  }, { noCsrf: true });

  r.get("/tickets/:token", (ctx) => {
    const order = T.orderByToken(db, ctx.params.token);
    if (!order || !["paid", "rejected"].includes(order.status)) throw new UserError("הכרטיסים לא נמצאו", 404);
    const c = C.getCampaign(db, order.campaign_id);
    const tickets = T.ticketsOf(db, order.id).map((t) => ({
      ...t, qr: T.qrSvg(t.code), wallet: W.walletEnabled(),
      shareUrl: c.ticket_mode !== "named" && order.qty > 1 && t.status === "valid" ? `${origin(ctx)}/t/${T.ticketShareToken(db, t)}` : null,
    }));
    const invite = order.status === "paid" && T.salesOpen(c)
      ? { url: `${origin(ctx)}/i/${T.inviteCode(db, order)}`, count: T.invitedCount(db, order.id) }
      : null;
    ctx.send(TV.ticketsPage(ctx, { c, order, tickets, invite, fresh: ctx.query.new === "1", url: ticketsUrl(ctx, order) }, opts(ctx)));
  });

  // כרטיס בודד שהועבר לחבר
  r.get("/t/:token", (ctx) => {
    const t = T.ticketByShare(db, ctx.params.token);
    if (!t || t.order_status !== "paid") throw new UserError("הכרטיס לא נמצא", 404);
    const c = C.getCampaign(db, t.campaign_id);
    if (c.ticket_mode === "named") throw new UserError("כרטיס שמי לא ניתן להעברה", 404);
    ctx.send(TV.singleTicketPage(ctx, { c, t: { ...t, qr: T.qrSvg(t.code), wallet: W.walletEnabled() } }, opts(ctx)));
  });

  // "תזכירו לי": בלי חשבון, רק מייל והסכמה מפורשת
  r.post("/s/:id/remind", async (ctx) => {
    const c = campaignOr404(ctx.params.id);
    rateLimit(`remind:${ctx.ip}`, 10, 3600_000);
    const ref = refFor(ctx, c.id);
    const code = ref ? db.prepare("SELECT l.code FROM referral_clicks k JOIN referral_links l ON l.id = k.link_id WHERE k.token = ?").get(ref.token)?.code : null;
    T.addReminder(db, c, { ...(await ctx.form()), refCode: code });
    ctx.redirect(`/s/${c.id}`, "נזכיר לך במייל. אפשר לבטל בקישור שבמייל.");
  });

  r.get("/reminders/:token/cancel", (ctx) => {
    T.cancelReminder(db, ctx.params.token);
    ctx.send(P.errorPage(ctx, 200, "בוטל. לא נשלח לך תזכורות על ההופעה הזו.", opts(ctx)));
  });

  // ---------- Wallet ----------
  const walletTicket = (ctx, t, c, order) => {
    if (!t || t.status !== "valid") throw new UserError("הכרטיס לא בתוקף", 404);
    const named = c.ticket_mode === "named" && !!t.holder_name;
    return { holder: named ? t.holder_name : order?.buyer_name ?? "", named, url: order ? ticketsUrl(ctx, order) : "", origin: origin(ctx) };
  };
  const sendPass = (ctx, c, t, o) => {
    if (!W.walletEnabled().apple) throw new UserError("Apple Wallet עוד לא הוגדר", 404);
    ctx.res.writeHead(200, { "content-type": "application/vnd.apple.pkpass", "content-disposition": `attachment; filename="jocares-${t.code}.pkpass"`, "cache-control": "no-store" });
    ctx.res.end(W.applePass(c, t, o));
  };
  const goGoogle = (ctx, c, t, o) => {
    if (!W.walletEnabled().google) throw new UserError("Google Wallet עוד לא הוגדר", 404);
    ctx.res.writeHead(302, { location: W.googleSaveUrl(c, t, o) });
    ctx.res.end();
  };
  const orderTicket = (ctx) => {
    const order = T.orderByToken(db, ctx.params.token);
    if (!order || order.status !== "paid") throw new UserError("הכרטיס לא נמצא", 404);
    const t = T.ticketsOf(db, order.id).find((x) => x.seq === Number(ctx.params.seq));
    const c = C.getCampaign(db, order.campaign_id);
    return { c, t, o: walletTicket(ctx, t, c, order) };
  };
  const sharedTicket = (ctx) => {
    const t = T.ticketByShare(db, ctx.params.token);
    if (!t || t.order_status !== "paid") throw new UserError("הכרטיס לא נמצא", 404);
    const c = C.getCampaign(db, t.campaign_id);
    if (c.ticket_mode === "named") throw new UserError("כרטיס שמי לא ניתן להעברה", 404);
    return { c, t, o: { ...walletTicket(ctx, t, c, null), holder: "" } };
  };
  r.get("/tickets/:token/wallet/:seq/apple.pkpass", (ctx) => { const { c, t, o } = orderTicket(ctx); sendPass(ctx, c, t, o); });
  r.get("/tickets/:token/wallet/:seq/google", (ctx) => { const { c, t, o } = orderTicket(ctx); goGoogle(ctx, c, t, o); });
  r.get("/t/:token/wallet/apple.pkpass", (ctx) => { const { c, t, o } = sharedTicket(ctx); sendPass(ctx, c, t, o); });
  r.get("/t/:token/wallet/google", (ctx) => { const { c, t, o } = sharedTicket(ctx); goGoogle(ctx, c, t, o); });

  r.get("/tickets/:token/calendar.ics", (ctx) => {
    const order = T.orderByToken(db, ctx.params.token);
    if (!order || order.status !== "paid") throw new UserError("הכרטיסים לא נמצאו", 404);
    const c = C.getCampaign(db, order.campaign_id);
    ctx.res.writeHead(200, { "content-type": "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="jocares-${c.id}.ics"` });
    ctx.res.end(T.ics(c, order, ticketsUrl(ctx, order)));
  });

  // עמוד התשלום של ספק הניסיון (מחליף עמוד תשלום מתארח של חברת סליקה)
  r.get("/pay/sandbox/:ref", (ctx) => {
    const p = sandboxPayment(db, ctx.params.ref);
    if (!p) throw new UserError("העסקה לא נמצאה", 404);
    if (p.status !== "pending") return ctx.redirect(new URL(p.return_url).pathname);
    ctx.send(TV.sandboxPayPage(ctx, { p }));
  });

  r.post("/pay/sandbox/:ref", async (ctx) => {
    const p = sandboxPayment(db, ctx.params.ref);
    if (!p) throw new UserError("העסקה לא נמצאה", 404);
    const status = sandboxPay(db, p.ref, (await ctx.form()).card);
    if (status === "failed") return ctx.send(TV.sandboxPayPage(ctx, { p: sandboxPayment(db, p.ref), error: "הכרטיס נדחה" }), 402);
    ctx.redirect(new URL(p.return_url).pathname);
  });

  // ---------- כניסה להופעה ----------

  const doorCampaign = (token) => {
    const c = T.campaignByDoor(db, token);
    if (!c) throw new UserError("הקישור לכניסה לא בתוקף", 404);
    return c;
  };

  // ---------- אפליקציית הכניסה ----------

  const doorApi = (base, resolve) => {
    const guard = async (ctx) => {
      // JSON מהאפליקציה: ה-csrf מגיע בכותרת, והגוף נקרא כאן
      if (ctx.req.method === "POST") {
        if (!ctx.cookies.vid || !safeEqual(String(ctx.req.headers["x-door-csrf"] ?? ""), ctx.csrf)) throw new UserError("פג תוקף. רעננו את הדף.", 403);
        rateLimit(`door:${ctx.ip}`, 1200, 600_000);
        try { ctx.body = JSON.parse((await readBody(ctx.req, 256 * 1024)) || "{}"); } catch { throw new UserError("בקשה לא תקינה", 400); }
      }
      return resolve(ctx);
    };
    const reply = (ctx, c, extra) => ctx.json({ ...extra, stats: DR.stats(db, c) });
    const fail = (ctx, e) => {
      if (!(e instanceof UserError)) throw e;
      ctx.res.writeHead(e.status || 400, { "content-type": "application/json; charset=utf-8" });
      ctx.res.end(JSON.stringify({ error: e.message }));
    };
    const wrap = (fn) => async (ctx) => { try { await fn(ctx); } catch (e) { fail(ctx, e); } };
    r.get(`${base}/manifest`, wrap(async (ctx) => { const { c } = await guard(ctx); ctx.json({ ...DR.manifest(db, c), stats: DR.stats(db, c) }); }));
    r.get(`${base}/search`, wrap(async (ctx) => { const { c } = await guard(ctx); ctx.json(DR.search(db, c, ctx.query.q)); }));
    r.post(`${base}/check`, wrap(async (ctx) => { const { c, staff } = await guard(ctx); reply(ctx, c, DR.admit(db, c, { code: ctx.body.code, staff, device: ctx.body.device })); }), { noCsrf: true });
    r.post(`${base}/checkid`, wrap(async (ctx) => { const { c, staff } = await guard(ctx); reply(ctx, c, DR.admit(db, c, { ticketId: ctx.body.id, staff, device: ctx.body.device })); }), { noCsrf: true });
    r.post(`${base}/undo`, wrap(async (ctx) => { const { c, staff } = await guard(ctx); reply(ctx, c, DR.undo(db, c, ctx.body.id, { staff, device: ctx.body.device })); }), { noCsrf: true });
    r.post(`${base}/sync`, wrap(async (ctx) => { const { c, staff } = await guard(ctx); reply(ctx, c, { results: DR.syncOffline(db, c, ctx.body.items, { staff, device: ctx.body.device }) }); }), { noCsrf: true });
  };
  doorApi("/door/api/e/:token", (ctx) => DR.resolveDoor(db, { eventToken: ctx.params.token }));
  doorApi("/door/api/s/:staff/:cid", (ctx) => DR.resolveDoor(db, { staffToken: ctx.params.staff, campaignId: ctx.params.cid }));

  // קישור של הופעה (כמו קודם): נפתח ישר לסורק
  r.get("/door/:token", (ctx) => {
    const { c } = DR.resolveDoor(db, { eventToken: ctx.params.token });
    ctx.send(DV.scanner(ctx, { c, apiBase: `/door/api/e/${ctx.params.token}`, stats: DR.stats(db, c), fallbackAction: `/door/${ctx.params.token}` }));
  });
  // גיבוי בלי JavaScript: טופס רגיל
  r.post("/door/:token", async (ctx) => {
    const { c } = DR.resolveDoor(db, { eventToken: ctx.params.token });
    rateLimit(`door:${ctx.ip}`, 600, 600_000);
    const last = T.checkIn(db, c, (await ctx.form()).code);
    ctx.send(TV.doorPage(ctx, { c, token: ctx.params.token, stats: T.doorStats(db, c.id), last }), last.result === "ok" ? 200 : 409);
  });

  // איש צוות: כל ההופעות של המארגן
  r.get("/door/s/:staff", (ctx) => {
    const staff = DR.staffByToken(db, ctx.params.staff);
    if (!staff) throw new UserError("הקישור לא בתוקף. בקשו קישור חדש מהמארגן.", 404);
    const organizer = db.prepare("SELECT name FROM artists WHERE id = ?").get(staff.artist_id)?.name ?? "";
    ctx.send(DV.staffHome(ctx, { staff, organizer, events: DR.eventsForStaff(db, staff), token: ctx.params.staff }));
  });
  r.get("/door/s/:staff/e/:cid", (ctx) => {
    const { c, staff } = DR.resolveDoor(db, { staffToken: ctx.params.staff, campaignId: ctx.params.cid });
    ctx.send(DV.scanner(ctx, { c, apiBase: `/door/api/s/${ctx.params.staff}/${c.id}`, staffName: staff.name, back: `/door/s/${ctx.params.staff}`, stats: DR.stats(db, c) }));
  });

  // המארגן מנהל את צוות הכניסה
  r.get("/artist/door", (ctx) => {
    if (!requireUser(ctx)) return;
    const orgs = ID.artistsOf(db, ctx.user.id).map((a) => ({ ...a, staff: DR.staffOf(db, a.id) }));
    ctx.send(A.doorStaffPage(ctx, { orgs, origin: origin(ctx) }, opts(ctx)));
  });
  r.post("/artist/door/:aid/add", async (ctx) => {
    if (!requireUser(ctx)) return;
    if (!ID.canManageArtist(db, ctx.user, Number(ctx.params.aid))) throw new UserError("לא נמצא", 404);
    DR.addStaff(db, ctx.user, ctx.params.aid, (await ctx.form()).name);
    ctx.redirect("/artist/door", "נוסף. שלחו לו/ה את הקישור.");
  });
  r.post("/artist/door/:aid/revoke/:sid", (ctx) => {
    if (!requireUser(ctx)) return;
    if (!ID.canManageArtist(db, ctx.user, Number(ctx.params.aid))) throw new UserError("לא נמצא", 404);
    DR.revokeStaff(db, ctx.user, ctx.params.aid, ctx.params.sid);
    ctx.redirect("/artist/door", "הגישה בוטלה. הקישור כבר לא עובד.");
  });

  // ---------- אמן ----------

  r.get("/artist", (ctx) => {
    if (!requireUser(ctx)) return;
    ctx.send(A.artistHome(ctx, { ...C.artistOverview(db, ctx.user.id), contentOrders: K.ordersForArtist(db, ctx.user.id) }, opts(ctx)));
  });

  r.get("/artist/new", (ctx) => {
    if (!requireUser(ctx)) return;
    ctx.send(A.newStep1(ctx, opts(ctx)));
  });

  // ברירת מחדל לטופס: מקום או הפקה ממלאים את השם שלהם, אמן ממלא את שמו כ"מי מופיע"
  const defaultsFor = (ctx) => {
    const a = ID.artistsOf(db, ctx.user.id)[0];
    if (!a) return {};
    return a.kind && a.kind !== "artist" ? { organizer_kind: a.kind, organizer_name: a.name, venue: a.kind === "venue" ? a.name : "" } : { artist_name: a.name };
  };

  r.post("/artist/new/extract", async (ctx) => {
    if (!requireUser(ctx)) return;
    rateLimit(`extract:${ctx.user.id}`, 20, 600_000);
    const f = await ctx.form();
    const found = await extractShow(String(f.url ?? "").trim());
    const keys = ["artist_name", "title", "starts_at", "venue", "city", "price", "image_url", "description"].filter((k) => found[k]);
    const v = { ...defaultsFor(ctx), ...found };
    const price = Number(v.price);
    if (price > 0) v.reward = C.suggestReward(Math.round(price * 100)) / 100;
    ctx.send(
      A.newForm(ctx, { v, found: keys, error: keys.length ? "" : "לא הצלחנו לקרוא את הפרטים מהלינק. אפשר למלא אותם כאן, זה לוקח דקה." }, opts(ctx))
    );
  });

  r.get("/artist/new/details", (ctx) => {
    if (!requireUser(ctx)) return;
    ctx.send(A.newForm(ctx, { v: defaultsFor(ctx) }, opts(ctx)));
  });

  r.post("/artist/new/details", async (ctx) => {
    if (!requireUser(ctx)) return;
    ctx.send(A.newForm(ctx, { v: await ctx.form() }, opts(ctx)));
  });

  r.post("/artist/new/preview", async (ctx) => {
    if (!requireUser(ctx)) return;
    const f = await ctx.form();
    let c;
    try {
      // התמונה נשמרת כבר עכשיו, והתצוגה המקדימה ממשיכה עם הנתיב שלה
      f.image_url = imageFromForm(f, { required: false }) || f.image_url;
      delete f.image;
      c = C.parseCampaignInput(f);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      return ctx.send(A.newForm(ctx, { v: f, error: e.message }, opts(ctx)), 400);
    }
    ctx.send(A.previewPage(ctx, { c, form: f }, opts(ctx)));
  });

  r.post("/artist/new", async (ctx) => {
    if (!requireUser(ctx)) return;
    rateLimit(`create:${ctx.user.id}`, 20, 3600_000);
    const f = await ctx.form();
    const id = C.createCampaign(db, ctx.user, f, { publish: f.publish === "1" });
    ctx.redirect(`/artist/c/${id}`, f.publish === "1" ? "ההופעה פורסמה. היא כבר מופיעה למקדמים." : "נשמר כטיוטה");
  });

  r.get("/artist/c/:id", (ctx) => {
    if (!requireUser(ctx)) return;
    const c = managed(ctx, ctx.params.id);
    ctx.send(
      A.manageCampaign(
        ctx,
        {
          c, r: C.campaignResults(db, c.id), top: C.topPromoters(db, c.id), publicUrl: `${origin(ctx)}/s/${c.id}`,
          lastImport: c.provider === "coupon" ? CP.lastImportAt(db, c.id) : null,
          sales: c.provider === "jocares"
            ? {
                s: T.salesSummary(db, c), orders: T.ordersOfCampaign(db, c.id), doorUrl: `${origin(ctx)}/door/${T.doorToken(db, c.id)}`, open: T.salesOpen(c),
                price: T.priceNow(db, c), statement: M.showStatement(db, c.id), payoutReady: !!M.artistPayout(db, c.artist_id),
              }
            : null,
          assets: R.assetsOf(db, c.id),
          offers: K.offersFor(db, c.id),
        },
        opts(ctx)
      )
    );
  });

  r.get("/artist/payout/:artistId", (ctx) => {
    if (!requireUser(ctx)) return;
    if (!ID.canManageArtist(db, ctx.user, Number(ctx.params.artistId))) throw new UserError("לא נמצא", 404);
    const artist = db.prepare("SELECT * FROM artists WHERE id = ?").get(Number(ctx.params.artistId));
    ctx.send(A.payoutPage(ctx, { artist, d: M.artistPayout(db, artist.id), types: M.BUSINESS_TYPES }, opts(ctx)));
  });

  r.post("/artist/payout/:artistId", async (ctx) => {
    if (!requireUser(ctx)) return;
    M.saveArtistPayout(db, ctx.user, ctx.params.artistId, await ctx.form());
    ctx.redirect("/artist", "הפרטים נשמרו. הכסף מהמכירות יועבר לחשבון הזה.");
  });

  r.get("/artist/c/:id/jokers", (ctx) => {
    if (!requireUser(ctx)) return;
    const c = managed(ctx, ctx.params.id);
    const rows = J.jokersForCampaign(db, c).map((x) => ({ ...x, v: J.publicView(x.j, x.p, { forArtist: true }) }));
    ctx.send(JV.artistJokersPage(ctx, { c, rows }, opts(ctx)));
  });

  r.post("/artist/c/:id/invite", async (ctx) => {
    if (!requireUser(ctx)) return;
    const c = managed(ctx, ctx.params.id);
    rateLimit(`invite:${ctx.user.id}`, 60, 3600_000);
    J.inviteJoker(db, ctx.user, c.id, await ctx.form());
    ctx.redirect(`/artist/c/${c.id}/jokers`, "ההזמנה נשלחה");
  });

  r.post("/artist/c/:id/capacity", async (ctx) => {
    if (!requireUser(ctx)) return;
    const c = managed(ctx, ctx.params.id);
    T.setCapacity(db, ctx.user, c, (await ctx.form()).capacity);
    ctx.redirect(`/artist/c/${c.id}`, "מספר הכרטיסים עודכן");
  });

  r.post("/artist/c/:id/refund", async (ctx) => {
    if (!requireUser(ctx)) return;
    const c = managed(ctx, ctx.params.id);
    const f = await ctx.form();
    const o = T.ticketOrder(db, f.order);
    if (!o || o.campaign_id !== c.id) throw new UserError("ההזמנה לא נמצאה");
    T.refundTickets(db, ctx.user, o.id, f.qty, "החזר מהאמן");
    await T.processRefunds(db);
    ctx.redirect(`/artist/c/${c.id}`, "הוחזר. הכרטיסים כבר לא בתוקף, והכסף חוזר לקונה.");
  });

  r.get("/artist/c/:id/buyers.csv", (ctx) => {
    if (!requireUser(ctx)) return;
    const c = managed(ctx, ctx.params.id);
    ID.audit(db, ctx.user.id, "tickets.export", "campaign", c.id, {});
    ctx.res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="jocares-buyers-${c.id}.csv"`, "cache-control": "no-store" });
    ctx.res.end(T.buyersCsv(db, c.id));
  });

  r.post("/artist/c/:id/early", async (ctx) => {
    if (!requireUser(ctx)) return;
    const c = managed(ctx, ctx.params.id);
    const f = await ctx.form();
    const e = T.setEarlyPrice(db, ctx.user, c, f.clear === "1" ? {} : f);
    ctx.redirect(`/artist/c/${c.id}`, e.early_price_agorot ? "המחיר המוקדם נשמר" : "המחיר המוקדם בוטל");
  });

  r.post("/artist/c/:id/assets", async (ctx) => {
    if (!requireUser(ctx)) return;
    const c = managed(ctx, ctx.params.id);
    const f = await ctx.form();
    if (!f.media?.data?.length) throw new UserError("לא נבחר קובץ");
    const m = saveMedia(f.media);
    R.addAsset(db, ctx.user, c.id, { url: m.url, kind: m.kind });
    ctx.redirect(`/artist/c/${c.id}#kit`, m.kind === "video" ? "הסרטון נוסף לערכת השיתוף" : "התמונה נוספה לערכת השיתוף");
  });

  r.post("/artist/c/:id/assets/:aid/delete", (ctx) => {
    if (!requireUser(ctx)) return;
    const c = managed(ctx, ctx.params.id);
    R.removeAsset(db, ctx.user, c.id, ctx.params.aid);
    ctx.redirect(`/artist/c/${c.id}#kit`, "נמחק");
  });

  r.post("/artist/c/:id/offers/:oid/dismiss", (ctx) => {
    if (!requireUser(ctx)) return;
    const c = managed(ctx, ctx.params.id);
    K.dismissOffer(db, ctx.user, c.id, ctx.params.oid);
    ctx.redirect(`/artist/c/${c.id}#offers`, "ההצעה הוסרה");
  });

  r.post("/artist/c/:id/door/rotate", (ctx) => {
    if (!requireUser(ctx)) return;
    const c = managed(ctx, ctx.params.id);
    T.rotateDoorToken(db, ctx.user, c.id);
    ctx.redirect(`/artist/c/${c.id}`, "נוצר קישור חדש לכניסה");
  });

  r.post("/artist/c/:id/status", async (ctx) => {
    if (!requireUser(ctx)) return;
    const c = managed(ctx, ctx.params.id);
    const f = await ctx.form();
    if (f.to === "sold_out") throw new UserError("המצב הזה נקבע אוטומטית");
    C.setStatus(db, ctx.user, c.id, String(f.to));
    if (f.to === "cancelled") await T.processRefunds(db);
    ctx.redirect(ctx.user.is_admin && !ID.artistsOf(db, ctx.user.id).some((a) => a.id === c.artist_id) ? "/admin?tab=campaigns" : `/artist/c/${c.id}`, "עודכן");
  });

  r.post("/artist/c/:id/reward", async (ctx) => {
    if (!requireUser(ctx)) return;
    const c = managed(ctx, ctx.params.id);
    C.changeReward(db, ctx.user, c.id, (await ctx.form()).reward);
    ctx.redirect(`/artist/c/${c.id}`, "התגמול עודכן למכירות מעכשיו. המקדמים קיבלו עדכון.");
  });

  r.post("/artist/c/:id/details", async (ctx) => {
    if (!requireUser(ctx)) return;
    const c = managed(ctx, ctx.params.id);
    const f = await ctx.form();
    f.image_url = imageFromForm(f, { required: false }) || c.image_url;
    C.updateCampaignDetails(db, ctx.user, c.id, f);
    ctx.redirect(`/artist/c/${c.id}`, "נשמר");
  });

  // ---------- מודול התוכן ----------

  r.get("/grow", (ctx) => ctx.send(CV.growPage(ctx, opts(ctx))));

  r.get("/creators", (ctx) => {
    const kind = ["content", "exposure"].includes(ctx.query.kind) ? ctx.query.kind : "";
    const goal = K.GOALS[ctx.query.goal] ? ctx.query.goal : "";
    ctx.send(CV.creatorsPage(ctx, { creators: K.discoverCreators(db, { viewerId: ctx.user?.id, kind }), kind, goal }, opts(ctx)));
  });

  r.get("/creators/:id", (ctx) => {
    const c = K.creatorPublic(db, Number(ctx.params.id));
    if (!c || (c.status !== "active" && !ctx.user?.is_admin && ctx.user?.id !== c.user_id)) throw new UserError("הפרופיל לא נמצא", 404);
    ctx.send(CV.creatorProfilePage(ctx, { c, goal: K.GOALS[ctx.query.goal] ? ctx.query.goal : "" }, opts(ctx)));
  });

  r.get("/services/:id/order", (ctx) => {
    if (!requireUser(ctx)) return;
    const s = K.getService(db, ctx.params.id);
    if (!s || !s.active) throw new UserError("השירות לא זמין", 404);
    const artists = ID.artistsOf(db, ctx.user.id);
    const campaigns = C.campaignsOfUser(db, ctx.user.id).filter((c) => ["active", "paused", "draft"].includes(c.status));
    const pre = campaigns.find((c) => c.id === Number(ctx.query.campaign));
    ctx.send(CV.orderNewPage(ctx, { s, creator: K.getProfile(db, s.user_id), artistName: pre?.artist_name ?? artists[0]?.name ?? ctx.user.name ?? "", campaigns, campaignId: pre?.id ?? null, goal: ctx.query.goal ?? (pre ? "show" : "") }, opts(ctx)));
  });

  r.post("/services/:id/order", async (ctx) => {
    if (!requireUser(ctx)) return;
    rateLimit(`order:${ctx.user.id}`, 20, 3600_000);
    const id = K.placeOrder(db, ctx.user, ctx.params.id, await ctx.form());
    ctx.redirect(`/orders/${id}`, "ההזמנה נשלחה. נעדכן כשהיוצר יאשר.");
  });

  r.get("/orders/:id", (ctx) => {
    if (!requireUser(ctx)) return;
    const o = K.getOrder(db, ctx.params.id);
    const role = K.roleIn(o, ctx.user);
    if (!role) throw new UserError("ההזמנה לא נמצאה", 404);
    let linkInfo = null;
    if (o.link_id) {
      const c = C.getCampaign(db, o.campaign_id);
      linkInfo = { reward: c.reward_agorot, tickets: R.linkStats(db, o.link_id).tickets };
    }
    ctx.send(CV.orderPage(ctx, {
      o, role, linkInfo,
      deliverables: K.deliverablesOf(db, o.id), revisions: K.revisionsOf(db, o.id), publication: K.publicationOf(db, o.id),
      disputes: db.prepare("SELECT * FROM disputes WHERE service_order_id = ? ORDER BY id").all(o.id),
    }, opts(ctx)));
  });

  const orderAction = (name, fn, msg) =>
    r.post(`/orders/:id/${name}`, async (ctx) => {
      if (!requireUser(ctx)) return;
      await fn(ctx, await ctx.form());
      ctx.redirect(`/orders/${ctx.params.id}`, msg);
    });
  orderAction("accept", (ctx) => K.acceptOrder(db, ctx.user, ctx.params.id), "יצאנו לדרך. בהצלחה!");
  orderAction("decline", (ctx, f) => K.declineOrder(db, ctx.user, ctx.params.id, f.reason), "ההזמנה נדחתה והאמן עודכן");
  orderAction("deliver", (ctx, f) => K.submitDeliverable(db, ctx.user, ctx.params.id, f), "נשלח לאמן");
  orderAction("publish", (ctx, f) => K.submitPublication(db, ctx.user, ctx.params.id, f), "תודה! האמן יאמת את הפרסום");
  orderAction("approve", (ctx) => K.approveOrder(db, ctx.user, ctx.params.id), "אושר");
  orderAction("revise", (ctx, f) => K.requestRevision(db, ctx.user, ctx.params.id, f.message), "בקשת התיקון נשלחה");
  orderAction("verify", (ctx) => K.verifyPublication(db, ctx.user, ctx.params.id), "הושלם");
  orderAction("cancel", (ctx) => K.cancelOrder(db, ctx.user, ctx.params.id), "ההזמנה בוטלה ולא חויבת");
  orderAction("dispute", (ctx, f) => K.openOrderDispute(db, ctx.user, ctx.params.id, f.message), "הפנייה הועברה לצוות");

  r.get("/creator", (ctx) => {
    if (!requireUser(ctx)) return;
    const uid = ctx.user.id;
    ctx.send(CV.creatorHome(ctx, {
      profile: K.getProfile(db, uid), services: K.servicesOf(db, uid), orders: K.ordersForCreator(db, uid),
      portfolio: K.portfolio(db, uid), channels: K.channels(db, uid),
    }, opts(ctx)));
  });

  const creatorPost = (path, fn, msg, to = "/creator") =>
    r.post(path, async (ctx) => {
      if (!requireUser(ctx)) return;
      const dest = await fn(ctx, await ctx.form());
      ctx.redirect(typeof dest === "string" ? dest : to, msg);
    });
  creatorPost("/creator/profile", (ctx, f) => {
    const isNew = !K.getProfile(db, ctx.user.id);
    f.image_url = imageFromForm(f, { required: false }) || K.getProfile(db, ctx.user.id)?.image_url || "";
    K.saveProfile(db, ctx.user, f);
    return isNew ? "/creator/services/new" : "/creator";
  }, "נשמר");
  creatorPost("/creator/services/new", (ctx, f) => void K.saveService(db, ctx.user, f), "השירות פורסם. אמנים יכולים להזמין אותו.");
  creatorPost("/creator/services/:id/edit", (ctx, f) => void K.saveService(db, ctx.user, f, ctx.params.id), "נשמר. הזמנות קיימות נשארות בתנאים המקוריים.");
  creatorPost("/creator/services/:id/toggle", (ctx) => {
    const s = K.getService(db, ctx.params.id);
    if (s?.user_id === ctx.user.id) K.setServiceActive(db, ctx.user, s.id, !s.active);
  }, "עודכן");
  creatorPost("/creator/portfolio", (ctx, f) => K.addPortfolio(db, ctx.user, f), "נוסף");
  creatorPost("/creator/portfolio/:id/delete", (ctx) => K.removeOwned(db, ctx.user, "creator_portfolio", ctx.params.id), "הוסר");
  creatorPost("/creator/channels", (ctx, f) => K.addChannel(db, ctx.user, f), "נוסף");
  creatorPost("/creator/channels/:id/delete", (ctx) => K.removeOwned(db, ctx.user, "social_channels", ctx.params.id), "הוסר");

  r.get("/creator/services/new", (ctx) => {
    if (!requireUser(ctx)) return;
    if (!K.getProfile(db, ctx.user.id)) return ctx.redirect("/creator");
    ctx.send(CV.serviceForm(ctx, { template: K.TEMPLATES[ctx.query.template] ? ctx.query.template : null }, opts(ctx)));
  });
  r.get("/creator/services/:id/edit", (ctx) => {
    if (!requireUser(ctx)) return;
    const s = K.getService(db, ctx.params.id);
    if (!s || s.user_id !== ctx.user.id) throw new UserError("לא נמצא", 404);
    ctx.send(CV.serviceForm(ctx, { s }, opts(ctx)));
  });

  // ---------- Webhooks ממערכות כרטוס ----------

  r.post("/webhooks/:provider", async (ctx) => {
    const raw = await readBody(ctx.req);
    try {
      const out = I.ingestWebhook(db, ctx.params.provider, raw, ctx.req.headers);
      ctx.json({ ok: true, ...out });
    } catch (e) {
      ctx.json({ ok: false, error: e.message }, e.status ?? 500);
    }
  }, { noCsrf: true });

  // ---------- ספק כרטוס מדומה ----------

  r.get("/sim/checkout/:ext", (ctx) => {
    const ev = Sim.simEvent(db, ctx.params.ext);
    if (!ev || ev.cancelled) throw new UserError("ההופעה לא זמינה", 404);
    ctx.send(AD.simCheckout(ctx, { ev, ref: String(ctx.query.ref ?? "") }));
  });

  r.post("/sim/checkout/:ext", async (ctx) => {
    const ev = Sim.simEvent(db, ctx.params.ext);
    if (!ev) throw new UserError("ההופעה לא זמינה", 404);
    const f = await ctx.form();
    try {
      const o = Sim.simBuy(db, ev.external_id, f);
      ctx.redirect(`/sim/receipt/${o.id}`);
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      ctx.send(AD.simCheckout(ctx, { ev, ref: f.ref ?? "", error: e.message }), 400);
    }
  });

  r.get("/sim/receipt/:id", (ctx) => {
    const o = Sim.simOrder(db, ctx.params.id);
    if (!o) throw new UserError("לא נמצא", 404);
    ctx.send(AD.simReceipt(ctx, { o, backUrl: `/thanks?event=${encodeURIComponent(o.external_event_id)}` }));
  });

  // ---------- ניהול ----------

  r.get("/admin", (ctx) => {
    if (!requireUser(ctx)) return;
    requireAdmin(ctx);
    const tab = String(ctx.query.tab ?? "");
    const o = opts(ctx);
    const q = (sql, ...a) => db.prepare(sql).all(...a);
    switch (tab) {
      case "tickets":
        return ctx.send(AD.adminTickets(ctx, {
          totals: {
            ...db.prepare("SELECT COALESCE(SUM(qty - refunded_qty),0) tickets, COALESCE(SUM((qty - refunded_qty) * (unit_price_agorot - discount_agorot + fee_agorot)),0) gross FROM ticket_orders WHERE status = 'paid'").get(),
            failed: db.prepare("SELECT COUNT(*) n FROM ticket_refunds WHERE status = 'failed'").get().n,
            pending: db.prepare("SELECT COUNT(*) n FROM ticket_refunds WHERE status = 'pending'").get().n,
          },
          refunds: T.pendingRefunds(db),
          orders: q(`SELECT o.*, e.title FROM ticket_orders o JOIN campaigns c ON c.id = o.campaign_id JOIN events e ON e.id = c.event_id
                      WHERE o.status != 'pending' ORDER BY o.id DESC LIMIT 200`),
        }, o));
      case "payouts":
        return ctx.send(AD.adminPayouts(ctx, {
          rows: q(`SELECT p.*, u.name, u.email, u.payout_details_enc FROM payouts p JOIN users u ON u.id = p.user_id ORDER BY p.status = 'requested' DESC, p.id DESC LIMIT 200`)
            .map((p) => ({ ...p, details: M.payoutDetails(p) })),
        }, o));
      case "disputes":
        return ctx.send(AD.adminDisputes(ctx, {
          rows: q(`SELECT d.*, u.name, u.email, e.title FROM disputes d JOIN users u ON u.id = d.user_id
                    LEFT JOIN campaigns c ON c.id = d.campaign_id LEFT JOIN events e ON e.id = c.event_id
                    ORDER BY d.status = 'open' DESC, d.id DESC LIMIT 200`),
        }, o));
      case "orders":
        return ctx.send(AD.adminOrders(ctx, {
          rows: q(`SELECT o.*, e.title, u.name AS promoter_name, m.id AS commission_id, m.amount_agorot, m.status AS commission_status, m.payout_id
                     FROM orders o JOIN campaigns c ON c.id = o.campaign_id JOIN events e ON e.id = c.event_id
                     LEFT JOIN commissions m ON m.order_id = o.id AND m.kind = 'sale'
                     LEFT JOIN users u ON u.id = m.promoter_id ORDER BY o.id DESC LIMIT 300`),
        }, o));
      case "campaigns":
        return ctx.send(AD.adminCampaigns(ctx, { rows: q(`SELECT id FROM campaigns ORDER BY id DESC LIMIT 300`).map((x) => C.getCampaign(db, x.id)) }, o));
      case "users":
        return ctx.send(AD.adminUsers(ctx, { rows: q(`SELECT * FROM users ORDER BY id DESC LIMIT 500`) }, o));
      case "audit":
        return ctx.send(AD.adminAudit(ctx, { rows: q(`SELECT a.*, u.email AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 300`) }, o));
      case "coupons":
        return ctx.send(AD.adminCoupons(ctx, { queue: CP.couponQueue(db) }, o));
      case "content":
        return ctx.send(AD.adminContentTab(ctx, {
          orders: K.allOrders(db),
          creators: q(`SELECT p.*, u.email, (SELECT COUNT(*) FROM creator_services s WHERE s.user_id = p.user_id AND s.active = 1) AS services
                         FROM creator_profiles p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 300`),
        }, o));
      case "sim":
        return ctx.send(AD.adminSim(ctx, { orders: Sim.simOrders(db, 100), events: q(`SELECT * FROM sim_events ORDER BY rowid DESC LIMIT 100`) }, o));
      default: {
        const n = (sql) => db.prepare(sql).get().n;
        const counts = {
          "משתמשים": n("SELECT COUNT(*) n FROM users"),
          "קמפיינים פעילים": n("SELECT COUNT(*) n FROM campaigns WHERE status = 'active'"),
          "מקדמים פעילים": n("SELECT COUNT(DISTINCT promoter_id) n FROM referral_links"),
          "כרטיסים דרך מקדמים": n("SELECT COALESCE(SUM(MIN(rewarded_qty, qty - refunded_qty)),0) n FROM orders WHERE cancelled = 0"),
          "עמלות פלטפורמה": n("SELECT COALESCE(SUM(fee_agorot),0) n FROM orders") / 100 + " ₪",
          "תשלומים ממתינים": n("SELECT COUNT(*) n FROM payouts WHERE status = 'requested'"),
          "פניות פתוחות": n("SELECT COUNT(*) n FROM disputes WHERE status = 'open'"),
        };
        return ctx.send(AD.adminOverview(ctx, { counts, issues: M.reconciliationIssues(db), webhooks: q(`SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT 20`) }, o));
      }
    }
  });

  const adminPost = (pathPattern, fn) =>
    r.post(pathPattern, async (ctx) => {
      if (!requireUser(ctx)) return;
      requireAdmin(ctx);
      await fn(ctx, await ctx.form());
    });

  adminPost("/admin/tickets/retry-refunds", async (ctx) => {
    const n = await T.processRefunds(db);
    ctx.redirect("/admin?tab=tickets", `בוצעו ${n} החזרים`);
  });

  // ---------- קופונים (צוות) ----------

  const adminGet = (pathPattern, fn) =>
    r.get(pathPattern, (ctx) => {
      if (!requireUser(ctx)) return;
      requireAdmin(ctx);
      return fn(ctx);
    });

  adminGet("/admin/coupons/:id", (ctx) => {
    const c = campaignOr404(ctx.params.id);
    if (c.provider !== "coupon") throw new UserError("ההופעה לא במסלול הקופונים", 404);
    ctx.send(AD.adminCouponCampaign(ctx, {
      c, codes: CP.campaignCodes(db, c.id), lastImport: CP.lastImportAt(db, c.id),
      imports: db.prepare("SELECT id, filename, status, summary, created_at FROM sales_imports WHERE campaign_id = ? ORDER BY id DESC LIMIT 20").all(c.id),
    }, opts(ctx)));
  });

  adminGet("/admin/coupons/:id/codes.csv", (ctx) => {
    const c = campaignOr404(ctx.params.id);
    const rows = CP.campaignCodes(db, c.id).filter((x) => !x.coupon_registered_at);
    ctx.res.writeHead(200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="jocares-codes-${c.id}.csv"`,
    });
    ctx.res.end("\uFEFFcode,discount_percent\n" + rows.map((x) => `${x.coupon_code},0`).join("\n") + "\n");
  });

  adminPost("/admin/coupons/:id/registered", (ctx) => {
    const n = CP.markRegistered(db, ctx.user, ctx.params.id);
    ctx.redirect(`/admin/coupons/${ctx.params.id}`, `${n} קודים סומנו כמוגדרים`);
  });

  adminPost("/admin/coupons/:id/import", (ctx, f) => {
    if (!f.file?.data?.length) throw new UserError("לא נבחר קובץ");
    let csv;
    try {
      csv = new TextDecoder("utf-8", { fatal: true }).decode(f.file.data);
    } catch {
      csv = new TextDecoder("windows-1255").decode(f.file.data); // ייצוא אקסל בעברית
    }
    const id = CP.previewImport(db, ctx.user, ctx.params.id, { csv, filename: f.file.filename });
    ctx.redirect(`/admin/imports/${id}`);
  });

  adminGet("/admin/imports/:id", (ctx) => ctx.send(AD.adminImport(ctx, CP.describeImport(db, ctx.params.id), opts(ctx))));

  adminPost("/admin/imports/:id/map", (ctx, f) => {
    CP.remapImport(db, ctx.params.id, f);
    ctx.redirect(`/admin/imports/${ctx.params.id}`);
  });

  adminPost("/admin/imports/:id/apply", (ctx) => {
    const res = CP.applyImport(db, ctx.user, ctx.params.id);
    const added = Object.entries(res).filter(([k]) => k === "new:ok").reduce((s, [, v]) => s + v, 0);
    ctx.redirect(`/admin/imports/${ctx.params.id}`, `הוחל: ${added} מכירות שויכו לג׳וקרים, ${res.refund ?? 0} עדכוני החזר`);
  });

  adminPost("/admin/imports/:id/discard", (ctx) => {
    db.prepare("UPDATE sales_imports SET status = 'discarded' WHERE id = ? AND status = 'preview'").run(Number(ctx.params.id));
    const imp = db.prepare("SELECT campaign_id FROM sales_imports WHERE id = ?").get(Number(ctx.params.id));
    ctx.redirect(`/admin/coupons/${imp?.campaign_id ?? ""}`, "בוטל");
  });

  adminPost("/admin/settle", (ctx) => {
    const res = M.settle(db);
    ctx.redirect("/admin", `${res.ended} קמפיינים הסתיימו, ${res.released} תגמולים שוחררו, ${res.content} הזמנות תוכן עודכנו`);
  });
  adminPost("/admin/orders/:id/resolve", (ctx, f) => {
    K.resolveOrderDispute(db, ctx.user, ctx.params.id, f);
    ctx.redirect(`/orders/${ctx.params.id}`, "ההחלטה נשמרה ושני הצדדים עודכנו");
  });
  adminPost("/admin/creators/:id/status", (ctx, f) => {
    K.setProfileStatus(db, ctx.user, Number(ctx.params.id), f.status);
    ctx.redirect("/admin?tab=content", "עודכן");
  });
  adminPost("/admin/payouts/:id", (ctx, f) => {
    M.decidePayout(db, ctx.user, ctx.params.id, f.outcome === "paid" ? "paid" : "failed", f.reference);
    ctx.redirect("/admin?tab=payouts", "עודכן");
  });
  adminPost("/admin/disputes/:id", (ctx, f) => {
    M.resolveDispute(db, ctx.user, ctx.params.id, f);
    ctx.redirect("/admin?tab=disputes", "טופל");
  });
  adminPost("/admin/commissions/:id/dispute", (ctx, f) => {
    M.setCommissionDisputed(db, ctx.user, ctx.params.id, f.on === "1");
    ctx.redirect("/admin?tab=orders", "עודכן");
  });
  adminPost("/admin/users/:id/freeze", (ctx, f) => {
    ID.setFrozen(db, ctx.user.id, Number(ctx.params.id), f.on === "1");
    ctx.redirect("/admin?tab=users", "עודכן");
  });
  adminPost("/admin/sim/refund", (ctx, f) => {
    Sim.simRefund(db, f.order, f.qty);
    ctx.redirect("/admin?tab=sim", "החזר נשלח");
  });
  adminPost("/admin/sim/replay", (ctx, f) => {
    // שולח מחדש אירוע order.paid זהה, כמו retry של ספק. התוצאה צריכה להיות "duplicate".
    const row = db
      .prepare("SELECT event_id FROM webhook_events WHERE type = 'order.paid' AND result LIKE ? ORDER BY received_at DESC LIMIT 1")
      .get(`order:${db.prepare("SELECT id FROM orders WHERE external_order_id = ?").get(f.order)?.id}:%`);
    const o = Sim.simOrder(db, f.order);
    const raw = JSON.stringify({ id: row?.event_id ?? "evt_missing", type: "order.paid", created: clock.iso(),
      data: { order_id: o.id, event_id: o.external_event_id, qty: o.qty, unit_price_agorot: o.unit_price_agorot, buyer_email: o.buyer_email, ref: o.ref || null, ordered_at: o.created_at } });
    const res = Sim.simReplay(raw);
    ctx.redirect("/admin?tab=sim", `נשלח שוב: ${res.status}`);
  });
  adminPost("/admin/sim/cancel", (ctx, f) => {
    Sim.simCancelEvent(db, f.event);
    ctx.redirect("/admin?tab=sim", "ההופעה בוטלה אצל הספק");
  });

  // ---------- סביבת בדיקה: קוד גישה לפיילוט ----------
  // דף הנחיתה, ההסבר והתנאים פתוחים לכולם. כל השאר דורש קוד גישה (נשמר בעוגייה ל-30 יום).
  // בוטים של תצוגה מקדימה עוברים לדפי הופעה ולתמונות, כדי שאפשר יהיה לבדוק שיתוף בוואטסאפ.
  const pilotPass = () => process.env.STAGING_PASSWORD;
  const pilotToken = () => hmac(pilotPass(), "pilot-access");
  const PUBLIC_PATHS = /^\/(|how|terms|pilot|health|data-deletion|ops\/health)$|^\/(static|media|webhooks|tickets|door|t|reminders|j)\//;

  function stagingGate(req, res, ctx) {
    if (!pilotPass()) return false;
    const p = ctx.url.pathname;
    if (PUBLIC_PATHS.test(p)) return false;
    if (isCrawler(req) && req.method === "GET" && /^\/(s|r|i|j)\//.test(p)) return false;
    if (ctx.cookies.pilot && safeEqual(ctx.cookies.pilot, pilotToken())) return false;
    if (req.method !== "GET") {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("צריך קוד גישה לפיילוט");
      return true;
    }
    ctx.redirect(`/pilot?next=${encodeURIComponent(p + ctx.url.search)}`);
    return true;
  }

  r.get("/pilot", (ctx) => {
    if (!pilotPass()) return ctx.redirect("/");
    ctx.send(P.pilotPage(ctx, { next: safeNext(ctx.query.next) || "/login" }, opts(ctx)));
  });

  r.post("/pilot", async (ctx) => {
    if (!pilotPass()) return ctx.redirect("/");
    rateLimit(`pilot:${ctx.ip}`, 10, 600_000);
    const f = await ctx.form();
    const next = safeNext(f.next) || "/login";
    const code = String(f.code ?? "").trim();
    if (!(code.length === pilotPass().length && safeEqual(code, pilotPass()))) {
      ctx.flash = { ok: false, m: "הקוד לא נכון" };
      return ctx.send(P.pilotPage(ctx, { next }, opts(ctx)), 403);
    }
    ctx.setCookie(cookie("pilot", pilotToken(), { maxAge: 30 * 86400 }));
    ctx.redirect(next);
  });

  // ---------- טיפול בבקשה ----------

  return async (req, res) => {
    const ctx = makeCtx(req, res);
    ctx.origin = origin(ctx);
    try {
      if (stagingGate(req, res, ctx)) return;
      if (req.method === "GET" && ctx.url.pathname === "/static/jsqr.js") {
        res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": config.isProd ? "public, max-age=86400" : "no-cache" });
        return fs.createReadStream(JSQR).pipe(res);
      }
      if (req.method === "GET" && ctx.url.pathname.startsWith("/static/")) {
        const file = path.join(STATIC, path.basename(ctx.url.pathname));
        const type = STATIC_TYPES[path.extname(file)];
        if (!type || !fs.existsSync(file)) throw new UserError("לא נמצא", 404);
        res.writeHead(200, { "content-type": type, "cache-control": config.isProd ? "public, max-age=86400" : "no-cache" });
        return fs.createReadStream(file).pipe(res);
      }
      if (req.method === "GET" && ctx.url.pathname === "/health") return ctx.json({ ok: true });
      if (req.method === "GET" && ctx.url.pathname === "/ops/health") return ctx.json(opsHealth(db));
      if (req.method === "GET" && ctx.url.pathname.startsWith("/media/")) {
        if (serveMedia(ctx.url.pathname.slice(7), res, req.headers.range)) return;
        throw new UserError("התמונה לא נמצאה", 404);
      }

      ctx.user = ID.userFromSession(db, ctx.cookies.sid);
      const route = r.match(req.method, ctx.url.pathname);
      if (!route) throw new UserError("הדף לא נמצא", 404);
      ctx.params = route.params;
      if (req.method === "POST" && !route.opts.noCsrf) {
        rateLimit(`post:${ctx.ip}`, 120, 60_000);
        ctx.checkCsrf(await ctx.form());
      }
      await route.handler(ctx);
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof UserError) {
        // בטפסים: חוזרים לדף הקודם עם הודעה ברורה
        const back = req.method === "POST" && req.headers.referer ? safeNext(new URL(req.headers.referer, "http://x").pathname + new URL(req.headers.referer, "http://x").search) : "";
        if (back && err.status < 404) return ctx.redirect(back, { ok: false, m: err.message });
        return ctx.send(P.errorPage(ctx, err.status, err.message, opts(ctx)), err.status);
      }
      console.error(err);
      ops.errors.push(Date.now());
      ctx.send(P.errorPage(ctx, 500, "משהו השתבש אצלנו. נסו שוב בעוד רגע.", {}), 500);
    }
  };
}

// הפעלה ישירה
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = openDb();
  const port = Number(process.env.PORT ?? 3000);
  http.createServer(createApp(db)).listen(port, () => console.log(`JoCares רץ על http://localhost:${port}`));
  const tick = () => {
    try {
      const r = M.settle(db);
      ops.lastSettleAt = new Date().toISOString();
      ops.lastSettleError = null;
      if (r.ended || r.released || r.content || r.expired) console.log(`[settle] ended=${r.ended} released=${r.released} content=${r.content} expired=${r.expired}`);
      T.processRefunds(db).then((n) => n && console.log(`[refunds] ${n}`), (e) => console.error("[refunds]", e));
      CN.syncDue(db).then((n) => n && console.log(`[connections] ${n}`), (e) => console.error("[connections]", e));
      const base = (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/$/, "");
      T.processReminders(db, (rem, c, p) =>
        sendMail({
          to: rem.email,
          subject: `תזכורת: ${c.artist_name} · ${c.title}`,
          text: [
            `ביקשת שנזכיר לך: ${c.artist_name} · ${c.title}`,
            `${showDate(c.starts_at)} · ${c.venue}${c.city ? `, ${c.city}` : ""}`,
            p.early ? `המחיר המוקדם (${money(p.price)}) נגמר בקרוב.` : "",
            `כרטיסים: ${base}${rem.ref_code ? `/r/${rem.ref_code}` : `/s/${c.id}`}`,
            "",
            `לא רוצה תזכורות על ההופעה הזו? ${base}/reminders/${rem.token}/cancel`,
          ].filter((l) => l !== null).join("\n"),
        }).then((ok) => { if (!ok) console.log(`[dev] reminder for ${rem.email}: ${c.title}`); })
      ).then((n) => n && console.log(`[reminders] ${n}`), (e) => console.error("[reminders]", e));
    } catch (e) {
      console.error("[settle]", e);
      ops.lastSettleError = String(e.message);
    }
  };
  tick();
  setInterval(tick, 10 * 60_000).unref();
}
