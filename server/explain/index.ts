/**
 * Explanation entry point.
 *
 * Order of operations, and the reason it is this way round:
 *   1. Render the deterministic template FIRST, so a usable explanation always
 *      exists before any network call is attempted.
 *   2. Optionally ask the model for a nicer draft.
 *   3. Validate that draft. Anything that fails is discarded silently in favour
 *      of the template, with the failure recorded for the admin data-health view.
 *
 * The consequence the spec asks for (section Yod): route choice never depends
 * on the availability, latency or good behaviour of a language model.
 */

import type { Explanation } from '../../shared/types.ts'
import type { ExplanationPayload } from './payload.ts'
import { renderTemplate } from './template.ts'
import { validateExplanation } from './validate.ts'
import { draftExplanation } from './llm.ts'

export { buildPayload, type ExplanationPayload } from './payload.ts'
export { renderTemplate } from './template.ts'
export { validateExplanation } from './validate.ts'

/** Counters surfaced by GET /v1/health/data-feeds (spec section Tet-Zayin). */
export const explanationStats = {
  template: 0,
  llm: 0,
  rejected: 0,
  lastRejection: null as string | null,
}

export async function explain(payload: ExplanationPayload): Promise<Explanation> {
  const template = renderTemplate(payload)
  const reasonCodes = [...payload.positives, ...payload.alternative_negatives]

  const draft = await draftExplanation(payload)
  if (draft.text === null) {
    explanationStats.template++
    return {
      text: template,
      source: 'template',
      ...(draft.error && draft.error !== 'no_api_key' ? { fallbackReason: draft.error } : {}),
      reasonCodes,
    }
  }

  const validation = validateExplanation(draft.text, payload)
  if (!validation.ok) {
    explanationStats.rejected++
    explanationStats.lastRejection = validation.reason ?? 'unknown'
    return {
      text: template,
      source: 'template',
      fallbackReason: validation.reason ?? 'validation_failed',
      reasonCodes,
    }
  }

  explanationStats.llm++
  return { text: draft.text.trim(), source: 'llm', reasonCodes }
}
