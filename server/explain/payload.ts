/**
 * The structured payload - the ONLY thing the explanation layer ever sees.
 *
 * Spec section Yod: "the AI receives a structured object containing the
 * recommended route, the alternative, the extra time, two to five approved
 * factors, confidence and guardrail phrasings. It does not access sources
 * itself, does not invent an event, and does not compute a Safety Score."
 *
 * And section Kaf-Gimel, on what the AI must not know: "it does not need to
 * see raw police records, other users, camera frames or identities. It
 * receives only the structured output of the Safety Engine."
 *
 * That is enforced here by construction: this builder takes the engine's
 * result and emits a small, closed object. There is no path from the model to
 * the feature store, the reports table or the route geometry.
 */

import type { ReasonCode, Recommendation, ScoredRoute } from '../../shared/types.ts'
import { topReasons } from '../../shared/reasonCodes.ts'
import { PROHIBITED_CLAIMS } from '../../shared/guardrails.ts'
import type { RouteFacts } from '../safety/reasons.ts'

export interface ExplanationPayload {
  recommended_route: string
  /** Dominant street of the recommendation, so the text can say "via X". */
  recommended_via: string
  alternative_route: string | null
  alternative_via: string | null
  extra_time_minutes: number
  positives: ReasonCode[]
  alternative_negatives: ReasonCode[]
  confidence: 'high' | 'medium' | 'low'
  prohibited_claims: readonly string[]
  /**
   * Every number the text is allowed to contain. The validator rejects any
   * other digit, which is what stops a model from inventing "3 open bars" or
   * "2 incidents last week".
   */
  permitted_numbers: number[]
}

export function buildPayload(
  recommendation: Recommendation,
  routes: ScoredRoute[],
  facts: Map<string, RouteFacts>,
): ExplanationPayload {
  const recommended = routes.find((r) => r.id === recommendation.recommendedRouteId)
  if (!recommended) throw new Error('recommended route missing from route list')

  const alternativeId =
    recommendation.recommendedRouteId === recommendation.fastestRouteId
      ? routes.find((r) => r.id !== recommendation.recommendedRouteId)?.id ?? null
      : recommendation.fastestRouteId

  const extraMinutes = Math.round(recommendation.extraTimeS / 60)

  return {
    recommended_route: recommended.id,
    recommended_via: facts.get(recommended.id)?.dominantStreet ?? '',
    alternative_route: alternativeId,
    alternative_via: alternativeId ? facts.get(alternativeId)?.dominantStreet ?? null : null,
    extra_time_minutes: extraMinutes,
    positives: topReasons(recommendation.positives, 5),
    alternative_negatives: topReasons(recommendation.alternativeNegatives, 3),
    confidence: recommendation.confidence,
    prohibited_claims: PROHIBITED_CLAIMS,
    permitted_numbers: [extraMinutes],
  }
}
