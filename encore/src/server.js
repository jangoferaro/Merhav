import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import { clock, config, hmac, isEmail, normalizeEmail, safeEqual, UserError } from "./util.js";
import { cookie, isCrawler, makeCtx, rateLimit, readBody, Router, safeNext } from "./http.js";
import { sendLoginCode } from "./mailer.js";
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
import { imageFromForm, serveMedia } from "./media.js";
import { finishGoogleLogin, googleEnabled, startGoogleLogin } from "./auth-google.js";
import * as CP from "./domain/coupons.js";

const STATIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const STATIC_TYPES = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };
const REF_COOKIE_DAYS = config.attributionDays;

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
    if (isCrawler(ctx.req)) return ctx.redirect(`/s/${link.campaign_id}`);
    const click = R.recordClick(db, link, ctx.vid, ctx.req.headers.referer);
    ctx.setCookie(cookie(`ref_${link.campaign_id}`, click.token, { maxAge: REF_COOKIE_DAYS * 86400 }));
    ctx.redirect(`/s/${link.campaign_id}`);
  });

  const refFor = (ctx, campaignId) => {
    const token = ctx.cookies[`ref_${campaignId}`];
    if (!token) return null;
    const row = db
      .prepare(
        `SELECT k.token, u.name, u.id AS promoter_id, l.campaign_id FROM referral_clicks k
           JOIN referral_links l ON l.id = k.link_id JOIN users u ON u.id = l.promoter_id WHERE k.token = ?`
      )
      .get(token);
    return row && row.campaign_id === Number(campaignId) ? row : null;
  };

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
          buyable: ["active", "paused", "sold_out"].includes(c.status) && c.starts_at > clock.iso(),
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
    if (!requireUser(ctx)) return;
    R.getOrCreateLink(db, ctx.user, ctx.params.id);
    ctx.redirect(`/s/${ctx.params.id}/share`);
  });

  r.get("/s/:id/share", (ctx) => {
    if (!requireUser(ctx)) return;
    const c = campaignOr404(ctx.params.id);
    const link = R.getOrCreateLink(db, ctx.user, c.id);
    const url = `${origin(ctx)}/r/${link.code}`;
    const code = c.provider === "coupon" ? link.coupon_code : null;
    ctx.send(P.sharePage(ctx, { c, url, code, text: R.shareText(c, url, link), stats: R.linkStats(db, link.id), lastImport: code ? CP.lastImportAt(db, c.id) : null }, opts(ctx)));
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

  // ---------- אמן ----------

  r.get("/artist", (ctx) => {
    if (!requireUser(ctx)) return;
    ctx.send(A.artistHome(ctx, { ...C.artistOverview(db, ctx.user.id), contentOrders: K.ordersForArtist(db, ctx.user.id) }, opts(ctx)));
  });

  r.get("/artist/new", (ctx) => {
    if (!requireUser(ctx)) return;
    ctx.send(A.newStep1(ctx, opts(ctx)));
  });

  const defaultsFor = (ctx) => ({ artist_name: ID.artistsOf(db, ctx.user.id)[0]?.name ?? "" });

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
        { c, r: C.campaignResults(db, c.id), top: C.topPromoters(db, c.id), publicUrl: `${origin(ctx)}/s/${c.id}`, lastImport: c.provider === "coupon" ? CP.lastImportAt(db, c.id) : null },
        opts(ctx)
      )
    );
  });

  r.post("/artist/c/:id/status", async (ctx) => {
    if (!requireUser(ctx)) return;
    const c = managed(ctx, ctx.params.id);
    const f = await ctx.form();
    if (f.to === "sold_out") throw new UserError("המצב הזה נקבע אוטומטית");
    C.setStatus(db, ctx.user, c.id, String(f.to));
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
    ctx.send(CV.orderNewPage(ctx, { s, creator: K.getProfile(db, s.user_id), artistName: artists[0]?.name ?? ctx.user.name ?? "", campaigns, goal: ctx.query.goal ?? "" }, opts(ctx)));
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
  const PUBLIC_PATHS = /^\/(|how|terms|pilot|health)$|^\/(static|media|webhooks)\//;

  function stagingGate(req, res, ctx) {
    if (!pilotPass()) return false;
    const p = ctx.url.pathname;
    if (PUBLIC_PATHS.test(p)) return false;
    if (isCrawler(req) && req.method === "GET" && /^\/(s|r)\//.test(p)) return false;
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
      if (req.method === "GET" && ctx.url.pathname.startsWith("/static/")) {
        const file = path.join(STATIC, path.basename(ctx.url.pathname));
        const type = STATIC_TYPES[path.extname(file)];
        if (!type || !fs.existsSync(file)) throw new UserError("לא נמצא", 404);
        res.writeHead(200, { "content-type": type, "cache-control": config.isProd ? "public, max-age=86400" : "no-cache" });
        return fs.createReadStream(file).pipe(res);
      }
      if (req.method === "GET" && ctx.url.pathname === "/health") return ctx.json({ ok: true });
      if (req.method === "GET" && ctx.url.pathname.startsWith("/media/")) {
        if (serveMedia(ctx.url.pathname.slice(7), res)) return;
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
      ctx.send(P.errorPage(ctx, 500, "משהו השתבש אצלנו. נסו שוב בעוד רגע.", {}), 500);
    }
  };
}

// הפעלה ישירה
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = openDb();
  const port = Number(process.env.PORT ?? 3000);
  http.createServer(createApp(db)).listen(port, () => console.log(`Jocares רץ על http://localhost:${port}`));
  const tick = () => {
    try {
      const r = M.settle(db);
      if (r.ended || r.released || r.content) console.log(`[settle] ended=${r.ended} released=${r.released} content=${r.content}`);
    } catch (e) {
      console.error("[settle]", e);
    }
  };
  tick();
  setInterval(tick, 10 * 60_000).unref();
}
