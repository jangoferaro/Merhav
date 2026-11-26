// מתזמן עבודות רקע. כל עבודה רצה לבד (לא מתחילה שוב לפני שהקודמת הסתיימה), כישלון של אחת לא עוצר אחרות,
// ומצב כל עבודה (ריצה אחרונה, הצלחה אחרונה, שגיאה) מוצג ב-/ops/health.
export const jobs = new Map();

export function schedule(name, everyMs, fn, { runNow = true } = {}) {
  const j = { name, everyMs, running: false, runs: 0, failures: 0, lastStart: null, lastOk: null, lastError: null, lastMs: 0, timer: null };
  jobs.set(name, j);
  const run = async () => {
    if (j.running) return; // הקודמת עוד רצה: מדלגים
    j.running = true;
    j.lastStart = new Date().toISOString();
    const t0 = Date.now();
    try {
      const out = await fn();
      j.lastOk = new Date().toISOString();
      j.lastError = null;
      if (out) console.log(`[${name}] ${typeof out === "object" ? JSON.stringify(out) : out}`);
    } catch (e) {
      j.failures++;
      j.lastError = String(e?.message ?? e).slice(0, 300);
      console.error(`[${name}]`, e);
    } finally {
      j.runs++;
      j.lastMs = Date.now() - t0;
      j.running = false;
    }
  };
  j.run = run;
  j.timer = setInterval(run, everyMs);
  j.timer.unref();
  if (runNow) setImmediate(run);
  return j;
}

export function stopAll() {
  for (const j of jobs.values()) clearInterval(j.timer);
}

/** עבודה "תקועה": לא הצליחה זמן רב מ-3 מחזורים */
export function jobsHealth() {
  const now = Date.now();
  return [...jobs.values()].map((j) => ({
    name: j.name,
    ok: !!j.lastOk && now - Date.parse(j.lastOk) < Math.max(3 * j.everyMs, 5 * 60_000),
    last_ok: j.lastOk,
    last_error: j.lastError,
    failures: j.failures,
    ms: j.lastMs,
  }));
}

/** מחכה שכל העבודות שרצות עכשיו יסתיימו (לכיבוי מסודר) */
export async function drain(timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while ([...jobs.values()].some((j) => j.running) && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
}
