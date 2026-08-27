import { lookup } from "node:dns/promises";
import tls from "node:tls";
import { ENV } from "./env";

/**
 * בדיקת נגישות ליעד המודל, פעם אחת בעלייה.
 *
 * למה זה קיים: כשקריאה למודל נכשלת ברמת הרשת, ההודעה שמגיעה מ-Node
 * היא "fetch failed" — והיא זהה עבור שם שלא נפתר, יציאה חסומה ו-TLS
 * שנכשל. שלוש בעיות שונות לגמרי עם שלושה פתרונות שונים לגמרי.
 *
 * הבדיקה כאן מפרידה ביניהן לפני שמשתמש בכלל מנסה לדבר: היא פותרת שם,
 * פותחת חיבור, ומדווחת באיזה שלב זה נשבר. היא לא קוראת ל-API, לא
 * שולחת מפתח ולא עולה כלום.
 *
 * היא לעולם לא מפילה את השרת: אפליקציה שעולה ומדווחת שהיא לא מצליחה
 * להגיע ליעד עדיפה על אפליקציה שמסרבת לעלות.
 */

export type Reachability =
  | { ok: true; host: string; address: string; tlsMs: number }
  | { ok: false; host: string; stage: "dns" | "connect" | "tls"; detail: string };

const CONNECT_TIMEOUT_MS = 8000;

function hostFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}

export async function probeModelApi(
  baseUrl: string = ENV.apiBaseUrl
): Promise<Reachability> {
  const host = hostFromBaseUrl(baseUrl);

  let address: string;
  try {
    address = (await lookup(host)).address;
  } catch (error) {
    return {
      ok: false,
      host,
      stage: "dns",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const startedAt = Date.now();

  return new Promise<Reachability>(resolve => {
    let settled = false;
    const finish = (result: Reachability) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const socket = tls.connect(
      { host, port: 443, servername: host, timeout: CONNECT_TIMEOUT_MS },
      () => finish({ ok: true, host, address, tlsMs: Date.now() - startedAt })
    );

    socket.on("timeout", () =>
      finish({
        ok: false,
        host,
        stage: "connect",
        detail: `no answer within ${CONNECT_TIMEOUT_MS}ms (address ${address})`,
      })
    );

    socket.on("error", (error: NodeJS.ErrnoException) =>
      // שגיאה אחרי שהחיבור נפתח היא TLS; לפני כן היא ברמת החיבור
      finish({
        ok: false,
        host,
        stage: socket.connecting ? "connect" : "tls",
        detail: `${error.code ? `${error.code}: ` : ""}${error.message}`,
      })
    );
  });
}

/** שורה אחת בלוג. נקראת בעלייה, ולא חוסמת את ההאזנה. */
export async function logModelApiReachability(): Promise<void> {
  try {
    const result = await probeModelApi();
    if (result.ok) {
      console.log(
        `[reachability] ${result.host} נגיש (${result.address}, TLS ב-${result.tlsMs}ms)`
      );
    } else {
      console.error(
        `[reachability] ${result.host} לא נגיש — נשבר בשלב ${result.stage}: ${result.detail}`
      );
    }
  } catch (error) {
    console.error("[reachability] הבדיקה עצמה נכשלה:", error);
  }
}
