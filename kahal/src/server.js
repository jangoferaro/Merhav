import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.js";
import * as L from "./logic.js";
import * as V from "./views.js";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const REF_COOKIE_DAYS = 30;
const MAX_BODY = 32 * 1024;

function parseCookies(req) {
  return Object.fromEntries(
    (req.headers.cookie ?? "")
      .split(";")
      .map((p) => p.trim().split("="))
      .filter(([k, v]) => k && v)
      .map(([k, v]) => [k, decodeURIComponent(v)])
  );
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new L.UserError("הבקשה גדולה מדי"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(body))));
    req.on("error", reject);
  });
}

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const proto = req.headers["x-forwarded-proto"] ?? "http";
  return `${proto}://${req.headers.host}`;
}

export function createApp(db) {
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
    res.end(body);
  };
  const redirect = (res, to, headers = {}) => {
    res.writeHead(303, { location: to, ...headers });
    res.end();
  };
  const notFound = (res) => send(res, 404, V.errorPage(404, "הקישור לא קיים או שפג תוקפו."));

  /** מזהה מבקר אנונימי — כדי שכניסה חוזרת לקישור לא תיספר פעמיים. */
  function visitor(req, res, cookies) {
    if (cookies.vid) return cookies.vid;
    const vid = L.token(9);
    res.setHeader("set-cookie", [`vid=${vid}; Path=/; Max-Age=${365 * 86400}; HttpOnly; SameSite=Lax`]);
    return vid;
  }

  async function route(req, res) {
    const url = new URL(req.url, "http://x");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const method = req.method;
    const cookies = parseCookies(req);

    // קבצים סטטיים
    if (method === "GET" && parts.length === 1 && parts[0] === "style.css") {
      res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=3600" });
      return fs.createReadStream(path.join(PUBLIC_DIR, "style.css")).pipe(res);
    }

    if (method === "GET" && parts.length === 0) return send(res, 200, V.homePage());

    // אומן פותח אירוע
    if (method === "POST" && url.pathname === "/events") {
      const ev = L.createEvent(db, await readForm(req));
      return send(res, 201, V.createdPage({ event: ev, baseUrl: baseUrl(req) }));
    }

    // /e/:slug ...
    if (parts[0] === "e" && parts[1]) {
      const event = L.getEventBySlug(db, parts[1]);
      if (!event) return notFound(res);
      const refCookie = `ref_${event.id}`;

      if (method === "GET" && parts.length === 2) {
        // הגעה דרך קישור של שגריר: שומרים בעוגייה ל-30 יום (השגריר האחרון שהביא את הקונה זוכה)
        const ref = url.searchParams.get("ref");
        let agent = ref ? L.getAgentByCode(db, event.id, ref) : null;
        if (agent) {
          L.recordClick(db, agent.id, visitor(req, res, cookies));
          res.appendHeader("set-cookie", `${refCookie}=${agent.code}; Path=/; Max-Age=${REF_COOKIE_DAYS * 86400}; HttpOnly; SameSite=Lax`);
        } else if (cookies[refCookie]) {
          agent = L.getAgentByCode(db, event.id, cookies[refCookie]);
        }
        const left = event.capacity - L.ticketsSold(db, event.id);
        return send(res, 200, V.eventPage({ event, left, agent }));
      }

      if (method === "POST" && parts[2] === "buy") {
        const form = await readForm(req);
        const order = L.purchase(db, event, { ...form, refCode: cookies[refCookie] });
        return redirect(res, `/order/${order.token}`);
      }

      if (method === "POST" && parts[2] === "join") {
        const agent = L.joinAsAgent(db, event, await readForm(req));
        return redirect(res, `/agent/${agent.token}`);
      }
    }

    if (method === "GET" && parts[0] === "order" && parts[1]) {
      const order = L.getOrderByToken(db, parts[1]);
      if (!order) return notFound(res);
      const event = L.getEventById(db, order.event_id);
      return send(res, 200, V.orderPage({ event, order, tickets: L.ticketsForOrder(db, order.id), baseUrl: baseUrl(req) }));
    }

    if (method === "GET" && parts[0] === "agent" && parts[1]) {
      const agent = L.getAgentByToken(db, parts[1]);
      if (!agent) return notFound(res);
      const event = L.getEventById(db, agent.event_id);
      return send(res, 200, V.agentPage({ event, agent, stats: L.agentStats(db, agent.id), baseUrl: baseUrl(req) }));
    }

    // /manage/:adminToken ... — לוח האומן
    if (parts[0] === "manage" && parts[1]) {
      const event = L.getEventByAdminToken(db, parts[1]);
      if (!event) return notFound(res);
      const base = `/manage/${event.admin_token}`;
      const show = (flash, status = 200) =>
        send(
          res,
          status,
          V.managePage({
            event,
            summary: L.eventSummary(db, event.id),
            agents: L.leaderboard(db, event.id),
            orders: L.recentOrders(db, event.id),
            left: event.capacity - L.ticketsSold(db, event.id),
            baseUrl: baseUrl(req),
            flash,
          }),
          { "x-robots-tag": "noindex", "referrer-policy": "no-referrer" }
        );

      if (method === "GET" && parts.length === 2) {
        const msg = url.searchParams.get("msg");
        return show(msg ? { ok: true, message: msg } : undefined);
      }
      if (method === "POST" && parts[2] === "checkin") {
        const { code } = await readForm(req);
        return show(L.checkIn(db, event.id, code));
      }
      if (method === "POST" && parts[2] === "payout" && parts[3]) {
        const n = L.markAgentPaid(db, event.id, Number(parts[3]));
        return redirect(res, `${base}?msg=${encodeURIComponent(n ? "סומן ששולם ✓" : "אין מה לסמן")}`);
      }
    }

    return notFound(res);
  }

  return async (req, res) => {
    try {
      await route(req, res);
    } catch (err) {
      if (res.headersSent) return res.end();
      if (err instanceof L.UserError) return send(res, 400, V.errorPage(400, err.message));
      console.error(err);
      send(res, 500, V.errorPage(500, "משהו השתבש אצלנו. נסו שוב בעוד רגע."));
    }
  };
}

// הפעלה ישירה: node src/server.js
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 3000);
  http.createServer(createApp(openDb())).listen(port, () => console.log(`קהל רץ על http://localhost:${port}`));
}
