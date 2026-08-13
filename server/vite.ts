import type { Express } from "express";
import type { Server } from "http";
import path from "path";
import fs from "fs";
import express from "express";

/**
 * במצב פיתוח: מריץ את Vite במצב middleware בתוך אותו שרת Express,
 * כדי שלא צריך שרת נפרד ולא צריך proxy — הכל על אותה כתובת/פורט.
 */
export async function setupVite(app: Express, server: Server) {
  const { createServer: createViteServer } = await import("vite");

  const vite = await createViteServer({
    root: path.resolve(process.cwd(), "client"),
    server: {
      middlewareMode: true,
      hmr: { server },
    },
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientIndex = path.resolve(process.cwd(), "client", "index.html");
      let html = await fs.promises.readFile(clientIndex, "utf-8");
      html = await vite.transformIndexHtml(url, html);
      res.status(200).set({ "content-type": "text/html" }).end(html);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      next(error);
    }
  });
}

/** במצב פרודקשן: מגיש את קבצי ה-build הסטטיים של הלקוח. */
export function serveStatic(app: Express) {
  const distPath = path.resolve(process.cwd(), "dist", "client");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `לא נמצאה תיקיית build בנתיב ${distPath}. הריצו קודם "npm run build".`
    );
  }

  // קבצי ה-JS/CSS מ-Vite כוללים hash בשם הקובץ עצמו (למשל
  // index-BZu89vT6.js) — אם התוכן משתנה, השם משתנה. לכן בטוח
  // לתת להם קאש אגרסיבי וארוך.
  app.use(
    express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath !== path.resolve(distPath, "index.html")) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );

  // index.html עצמו חייב תמיד להיבדק מחדש מול השרת — אחרת דפדפן
  // (בעיקר Safari במובייל) יכול להישאר תקוע על גרסה ישנה בלי שום
  // דרך להבחין שיש עדכון, גם אחרי deploy מוצלח.
  app.use("*", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
