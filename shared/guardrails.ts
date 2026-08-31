/**
 * Language guardrails.
 *
 * Spec section Yod-Tet draws a hard line between permitted and forbidden
 * phrasing, and section Yod forbids the words outright:
 *   allowed   - "based on the information we have right now, we recommend..."
 *   forbidden - "the route is safe", "nothing will happen to you", "the other
 *               street is dangerous".
 *
 * Enforced at runtime in server/explain/validate.ts, so a model that drifts
 * gets its draft thrown away rather than shown.
 *
 * ---------------------------------------------------------------------------
 * A note on why these are not written with \b
 *
 * JavaScript's \b is defined against ASCII \w. Hebrew letters are not \w, so
 * in /\bבטוח\b/ neither boundary can ever match against a space or a string
 * edge - the pattern is dead, and the entire Hebrew half of this file would
 * silently pass everything. `hebrewWord` below builds a Unicode-aware boundary
 * with lookarounds instead.
 */

/**
 * Hebrew word matcher with a Unicode-aware boundary.
 *
 * Also allows one leading prefix letter, because Hebrew attaches conjunctions
 * and articles directly to the word ("ובטוח", "הבטוח") and those must be
 * caught too. Erring toward over-matching is deliberate: a false positive
 * costs one discarded draft and falls back to the deterministic template,
 * while a false negative ships an absolute safety claim to a user.
 */
function hebrewWord(body: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])[והבשכלמ]?${body}(?![\\p{L}\\p{N}])`, 'u')
}

/** Absolute-safety and absolute-danger claims, Hebrew. */
export const PROHIBITED_HE: RegExp[] = [
  hebrewWord('בטוח(ה|ים|ות)?'),
  hebrewWord('מסוכן'),
  hebrewWord('מסוכנת'),
  hebrewWord('מסוכנים'),
  hebrewWord('מסוכנות'),
  hebrewWord('מובטח(ת)?'),
  hebrewWord('מאובטח(ת)?'),
  hebrewWord('בוודאות'),
  /אין\s+סיכון/u,
  /אין\s+סכנה/u,
  /לא\s+יקרה\s+לך/u,
  /מבטיח(ים|ה)?\s+ש/u,
]

/** Same claims in English, for mixed-language drafts. */
export const PROHIBITED_EN: RegExp[] = [
  /\bsafe\b/i,
  /\bdangerous\b/i,
  /\bguarantee(d|s)?\b/i,
  /\bno risk\b/i,
  /\brisk-free\b/i,
  /\bsecure route\b/i,
]

/**
 * Person-describing language. Spec section Yod: "do not describe people by
 * appearance or affiliation"; section Bet non-goals: never rank neighbourhoods
 * or human groups as dangerous.
 */
export const PROHIBITED_PERSON_REFS: RegExp[] = [
  hebrewWord('חשוד(ים)?'),
  hebrewWord('עבריינ(ים|ות)'),
  hebrewWord('אוכלוסייה'),
  hebrewWord('אוכלוסיה'),
  /שכונה\s+(מסוכנת|בעייתית)/u,
  /סוג\s+אנשים/u,
  /\bsuspicious (people|person|individuals)\b/i,
  /\bbad neighbou?rhood\b/i,
]

export const ALL_PROHIBITED = [
  ...PROHIBITED_HE,
  ...PROHIBITED_EN,
  ...PROHIBITED_PERSON_REFS,
]

/** Claim strings handed to the model so the ban is also stated up front. */
export const PROHIBITED_CLAIMS = [
  'safe',
  'dangerous',
  'guaranteed',
  'no_risk',
  'crime_prediction',
  'person_description',
] as const

export interface GuardrailViolation {
  pattern: string
  match: string
}

/** Returns every banned phrase found in `text`. Empty array means clean. */
export function findViolations(text: string): GuardrailViolation[] {
  const found: GuardrailViolation[] = []
  for (const pattern of ALL_PROHIBITED) {
    const m = pattern.exec(text)
    if (m) found.push({ pattern: pattern.source, match: m[0] })
  }
  return found
}
