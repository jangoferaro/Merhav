/**
 * Guardrail validation for generated explanations.
 *
 * Acceptance criterion FR-05 (spec section Kaf-Alef): "the AI explanation does
 * not add facts that do not exist in the payload." A prompt cannot guarantee
 * that, so every draft is checked here and thrown away if it fails. The
 * deterministic template then answers instead.
 *
 * Three independent checks:
 *   1. Banned phrasing - the absolute safety/danger claims and person
 *      descriptions listed in shared/guardrails.ts.
 *   2. Invented numbers - any number in the text that is not in
 *      `permitted_numbers` is a fabricated quantity.
 *   3. Length - spec section Yod sets two to four lines as the default.
 */

import { findViolations } from '../../shared/guardrails.ts'
import type { ExplanationPayload } from './payload.ts'

export const MAX_EXPLANATION_CHARS = 420

export interface ValidationResult {
  ok: boolean
  /** Machine-readable failure reason, recorded on the Explanation when used. */
  reason?: string
}

/** Numbers written as digits. Hebrew number words are handled by the vocabulary. */
function extractNumbers(text: string): number[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) =>
    Number.parseFloat(m[0].replace(',', '.')),
  )
}

export function validateExplanation(
  text: string,
  payload: ExplanationPayload,
): ValidationResult {
  const trimmed = text.trim()

  if (trimmed.length === 0) return { ok: false, reason: 'empty_output' }
  if (trimmed.length > MAX_EXPLANATION_CHARS) {
    return { ok: false, reason: `too_long:${trimmed.length}` }
  }

  const violations = findViolations(trimmed)
  if (violations.length > 0) {
    return { ok: false, reason: `prohibited_claim:${violations.map((v) => v.match).join('|')}` }
  }

  const permitted = new Set(payload.permitted_numbers)
  const invented = extractNumbers(trimmed).filter((n) => !permitted.has(n))
  if (invented.length > 0) {
    return { ok: false, reason: `invented_number:${invented.join('|')}` }
  }

  return { ok: true }
}
