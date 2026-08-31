/**
 * Deterministic explanation templates.
 *
 * Spec section Yod, "Fallback without an LLM": "in case of a failure / cost /
 * latency the product must be able to phrase an explanation from a
 * deterministic template. The ability to choose a route never depends on the
 * availability of a language model."
 *
 * So this is not a degraded mode - it is the floor the product stands on. The
 * LLM path is an optional polish on top, and every draft it produces is
 * checked against the same rules this file follows by construction.
 */

import { REASON_SPECS } from '../../shared/reasonCodes.ts'
import type { ExplanationPayload } from './payload.ts'

function joinClauses(clauses: string[]): string {
  if (clauses.length === 0) return ''
  if (clauses.length === 1) return clauses[0]!
  return `${clauses.slice(0, -1).join(', ')} ו${clauses[clauses.length - 1]}`
}

function minutesPhrase(minutes: number): string {
  if (minutes <= 0) return ''
  if (minutes === 1) return 'זה מוסיף בערך דקה'
  if (minutes === 2) return 'זה מוסיף בערך שתי דקות'
  return `זה מוסיף בערך ${minutes} דקות`
}

/**
 * Two to four lines, relative phrasing, no absolute claims - the rules in
 * spec section Yod, met by construction rather than by instruction.
 */
export function renderTemplate(payload: ExplanationPayload): string {
  const sentences: string[] = []

  // 1. The recommendation and what it costs.
  const via = payload.recommended_via ? ` דרך ${payload.recommended_via}` : ''
  if (payload.positives.includes('negligible_difference')) {
    sentences.push(
      `אין הבדל משמעותי בין החלופות לפי המידע שיש לנו כרגע, אז עדיף פשוט ללכת בדרך הקצרה${via}.`,
    )
  } else if (payload.extra_time_minutes > 0) {
    sentences.push(`עדיף לך ללכת${via}. ${minutesPhrase(payload.extra_time_minutes)},`)
  } else {
    sentences.push(`אפשר ללכת${via} — זו גם הדרך הקצרה ביותר.`)
  }

  // 2. Why - the approved positives, and nothing else.
  //
  // The payload may carry up to five factors, because screen S03 lists them
  // all. The sentence takes at most three: `positives` arrives sorted by rank,
  // so this keeps the most decisive reasons and drops the padding that would
  // push the text past the spec's two-to-four lines.
  const positiveClauses = payload.positives
    .filter((c) => REASON_SPECS[c].polarity === 'positive')
    .slice(0, 3)
    .map((c) => REASON_SPECS[c].clause)
  if (positiveClauses.length > 0) {
    const lead = payload.extra_time_minutes > 0 ? 'אבל ' : ''
    sentences.push(`${lead}${joinClauses(positiveClauses)}.`)
  }

  // 3. What is less good about the alternative.
  const negativeClauses = payload.alternative_negatives.map((c) => REASON_SPECS[c].clause)
  if (negativeClauses.length > 0) {
    const alt = payload.alternative_via
      ? `המסלול דרך ${payload.alternative_via}`
      : 'המסלול החלופי'
    sentences.push(`${alt} — ${joinClauses(negativeClauses)}.`)
  }

  // 4. Say low confidence out loud, briefly (spec section Yod).
  if (payload.confidence === 'low') {
    sentences.push('חשוב לומר: המידע שיש לנו על הדרך הזאת חלקי, אז זו העדפה קלה בלבד.')
  } else if (payload.confidence === 'medium' || payload.positives.includes('sparse_data')) {
    sentences.push('ההמלצה מבוססת על המידע שיש לנו כרגע, והוא חלקי.')
  }

  return sentences.join(' ').replace(/\s+/g, ' ').replace(/,\s*אבל/g, ', אבל').trim()
}
