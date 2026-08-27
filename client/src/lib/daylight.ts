import type { LightPhase } from "@shared/ishmael";

/**
 * האור בחדר נקבע לפי האור בעולם.
 *
 * אם חשוך בחוץ — החדר חשוך. אם יום — יש אור. בין ערביים — קרן נמוכה
 * שנכנסת מהצד. זה לא עיטור: כשהמסך משתנה לפי השעה שבה האדם באמת יושב
 * מולו, החדר שמעבר לזכוכית מפסיק להיות תמונה ומתחיל להיות מקום.
 *
 * שני מסלולי חישוב:
 *   - עם מיקום (אם המשתמש אישר) — גובה השמש האמיתי. מדויק, ועובד גם
 *     בקווי רוחב שבהם "שבע בערב" זה צהריים או לילה.
 *   - בלי מיקום — ספי שעות. פחות מדויק, ולא דורש רשות משום דבר.
 */

const RAD = Math.PI / 180;

/** ימים מאז J2000.0 */
function daysSinceJ2000(date: Date): number {
  return date.getTime() / 86_400_000 - 10_957.5;
}

/**
 * גובה השמש במעלות מעל האופק.
 * נוסחה אסטרונומית מקוצרת — דיוק של כרבע מעלה, יותר ממספיק כדי לבחור
 * בין "לילה" ל"בין ערביים".
 */
export function sunAltitude(date: Date, latitude: number, longitude: number): number {
  const d = daysSinceJ2000(date);

  // אנומליה ממוצעת ואורך אקליפטי
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;

  // נטיית השמש
  const e = (23.439 - 0.00000036 * d) * RAD;
  const declination = Math.asin(Math.sin(e) * Math.sin(L));

  // זמן כוכבים מקומי, ומכאן זווית השעה
  const gmst = 18.697374558 + 24.06570982441908 * d;
  const lst = ((gmst % 24) + 24) % 24 + longitude / 15;
  const rightAscension = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const hourAngle = (lst * 15) * RAD - rightAscension;

  const lat = latitude * RAD;
  const altitude = Math.asin(
    Math.sin(lat) * Math.sin(declination) +
      Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle)
  );

  return altitude / RAD;
}

/**
 * שלב האור לפי גובה השמש.
 * `rising` מבחין בין שחר לבין דמדומים — אותו גובה בדיוק, שני מצבים
 * שונים לגמרי מבחינת מה שהעין רואה.
 */
export function phaseFromAltitude(altitude: number, rising: boolean): LightPhase {
  if (altitude > 6) return "day";
  if (altitude > -7) return rising ? "dawn" : "dusk";
  return "night";
}

/** מסלול הגיבוי — ספי שעות מקומיות. */
export function phaseFromHour(hour: number): LightPhase {
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

export type Coords = { latitude: number; longitude: number };

/** השלב עכשיו — עם מיקום אם יש, ובלעדיו לפי השעון. */
export function currentPhase(date: Date, coords: Coords | null): LightPhase {
  if (!coords) return phaseFromHour(date.getHours());

  const now = sunAltitude(date, coords.latitude, coords.longitude);
  const soon = sunAltitude(
    new Date(date.getTime() + 10 * 60_000),
    coords.latitude,
    coords.longitude
  );

  return phaseFromAltitude(now, soon > now);
}

/**
 * מבקש מיקום רק אם הדפדפן כבר אישר אותו — בלי לפוצץ בקשת הרשאה על
 * אדם שרק פתח שיחה. אם אין רשות, המסלול השני עובד בלי שאיש שם לב.
 */
export async function resolveCoords(): Promise<Coords | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return null;

  try {
    const permissions = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (permissions?.query) {
      const status = await permissions.query({ name: "geolocation" as PermissionName });
      if (status.state !== "granted") return null;
    } else {
      return null;
    }
  } catch {
    return null;
  }

  return new Promise<Coords | null>(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 4000, maximumAge: 3_600_000 }
    );
  });
}
