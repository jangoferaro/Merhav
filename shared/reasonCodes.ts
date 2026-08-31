/**
 * The reason-code vocabulary and its Hebrew surface forms.
 *
 * This module is the entire vocabulary the explanation layer is allowed to
 * speak in. Adding a phrase here is a product decision; the LLM cannot invent
 * one (spec section Yod: "it does not access sources itself, does not invent
 * an event, and does not compute a Safety Score").
 */

import type { ReasonCode, ReasonPolarity } from './types.ts'

export interface ReasonSpec {
  code: ReasonCode
  polarity: ReasonPolarity
  /** Short label for the "Why this route?" list (screen S03). */
  label: string
  /** Clause used by the deterministic template engine. */
  clause: string
  /** Priority when trimming to the 2-5 factors the spec allows. Lower first. */
  rank: number
}

export const REASON_SPECS: Record<ReasonCode, ReasonSpec> = {
  main_street: {
    code: 'main_street',
    polarity: 'positive',
    label: 'ציר ראשי',
    clause: 'המסלול עובר ברובו בצירים ראשיים',
    rank: 2,
  },
  open_places: {
    code: 'open_places',
    polarity: 'positive',
    label: 'מקומות פתוחים',
    clause: 'יש לאורך הדרך יותר עסקים ומקומות פתוחים',
    rank: 1,
  },
  active_transit: {
    code: 'active_transit',
    polarity: 'positive',
    label: 'תחבורה פעילה',
    clause: 'יש תחבורה ציבורית פעילה לאורך המסלול',
    rank: 4,
  },
  well_lit: {
    code: 'well_lit',
    polarity: 'positive',
    label: 'תאורה טובה',
    clause: 'התאורה לאורך הדרך טובה יותר לפי המידע שיש לנו',
    rank: 3,
  },
  human_activity: {
    code: 'human_activity',
    polarity: 'positive',
    label: 'רחוב פעיל',
    clause: 'הרחוב פעיל יותר בשעה הזאת',
    rank: 0,
  },
  shorter_route: {
    code: 'shorter_route',
    polarity: 'positive',
    label: 'הדרך הקצרה',
    clause: 'זו גם הדרך הקצרה ביותר',
    rank: 5,
  },

  low_activity: {
    code: 'low_activity',
    polarity: 'negative',
    label: 'מקטעים שקטים',
    clause: 'כולל כמה מקטעים שקטים יותר בשעה הזאת',
    rank: 0,
  },
  poor_lighting: {
    code: 'poor_lighting',
    polarity: 'negative',
    label: 'תאורה חלקית',
    clause: 'התאורה בחלק מהדרך חלקית לפי הדיווחים שיש לנו',
    rank: 2,
  },
  isolated_segment: {
    code: 'isolated_segment',
    polarity: 'negative',
    label: 'מקטע מבודד',
    clause: 'כולל מעבר מבודד יחסית',
    rank: 1,
  },
  park_at_night: {
    code: 'park_at_night',
    polarity: 'negative',
    label: 'מעבר בפארק בלילה',
    clause: 'עובר דרך פארק בשעת לילה',
    rank: 3,
  },
  recent_report: {
    code: 'recent_report',
    polarity: 'negative',
    label: 'דיווח טרי',
    clause: 'התקבל בו לאחרונה דיווח מהקהילה',
    rank: 1,
  },
  long_detour: {
    code: 'long_detour',
    polarity: 'negative',
    label: 'עיקוף ארוך',
    clause: 'העיקוף מוסיף יותר זמן ממה שהשיפור מצדיק',
    rank: 4,
  },

  sparse_data: {
    code: 'sparse_data',
    polarity: 'meta',
    label: 'מידע חלקי',
    clause: 'ההמלצה מבוססת על מידע חלקי',
    rank: 9,
  },
  negligible_difference: {
    code: 'negligible_difference',
    polarity: 'meta',
    label: 'הבדל זניח',
    clause: 'אין הבדל משמעותי בין החלופות, ולכן עדיף פשוט ללכת בדרך הקצרה',
    rank: 8,
  },
}

export const ALL_REASON_CODES = Object.keys(REASON_SPECS) as ReasonCode[]

export function isReasonCode(value: unknown): value is ReasonCode {
  return typeof value === 'string' && value in REASON_SPECS
}

/**
 * Spec section Yod allows two to five approved factors in the payload. Trim by
 * rank so the most decisive reasons survive.
 */
export function topReasons(codes: ReasonCode[], limit = 5): ReasonCode[] {
  return [...new Set(codes)]
    .sort((a, b) => REASON_SPECS[a].rank - REASON_SPECS[b].rank)
    .slice(0, limit)
}

export function reasonsByPolarity(
  codes: ReasonCode[],
  polarity: ReasonPolarity,
): ReasonCode[] {
  return codes.filter((c) => REASON_SPECS[c].polarity === polarity)
}
