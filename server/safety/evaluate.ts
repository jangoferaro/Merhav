/**
 * The Safety Engine pipeline (spec section Heh, steps 3-6, and the sequence in
 * section Yod-Zayin).
 *
 *   routing alternatives -> segment enrichment -> segment scoring ->
 *   route aggregation -> reason codes -> decision policy
 *
 * The explanation step deliberately lives outside this module. By the time
 * anything here returns, the recommendation is final; language is added on
 * top and can never change it.
 */

import type {
  LatLng,
  Route,
  SafetyPreferences,
  ScoredRoute,
  SegmentScore,
  Recommendation,
} from '../../shared/types.ts'
import { DEFAULT_PREFERENCES } from '../../shared/types.ts'
import { getRoutingProvider } from '../routing/provider.ts'
import { getSegmentFeatures } from './signalStore.ts'
import { scoreSegment } from './segmentScore.ts'
import { aggregateRoute } from './routeScore.ts'
import { computeUtility, decide, preferenceMatch } from './decisionPolicy.ts'
import { deriveReasonCodes, describeRoute, type RouteFacts } from './reasons.ts'
import { MODEL_VERSION } from './weights.ts'

export interface EvaluationResult {
  routes: ScoredRoute[]
  recommendation: Recommendation
  facts: Map<string, RouteFacts>
  at: Date
  modelVersion: string
}

/** Score a set of already-computed routes. Split out so re-evaluation during a
 *  walk can reuse it without going back to the routing provider. */
export function scoreRoutes(
  routes: Route[],
  at: Date,
  prefs: SafetyPreferences,
): { scored: ScoredRoute[]; facts: Map<string, RouteFacts> } {
  // Enrich every distinct segment once, even when routes share it.
  const uniqueSegmentIds = [...new Set(routes.flatMap((r) => r.segmentIds))]
  const segmentScores = new Map<string, SegmentScore>()
  for (const id of uniqueSegmentIds) {
    segmentScores.set(id, scoreSegment(id, getSegmentFeatures(id, at), at))
  }

  const fastestDuration = Math.min(...routes.map((r) => r.durationS))
  const facts = new Map<string, RouteFacts>()

  const scored: ScoredRoute[] = routes.map((route) => {
    const scores = route.segmentIds.map((id) => segmentScores.get(id)!)
    const aggregate = aggregateRoute(route, scores)
    const routeFacts = describeRoute(route, scores, at)
    facts.set(route.id, routeFacts)

    const isFastest = route.durationS === fastestDuration
    const reasonCodes = deriveReasonCodes(routeFacts, isFastest, at)

    const partial: ScoredRoute = {
      ...route,
      ...aggregate,
      segmentScores: scores,
      reasonCodes,
      utility: 0,
    }

    const extraMinutes = (route.durationS - fastestDuration) / 60
    partial.utility = computeUtility({
      route: partial,
      extraMinutes,
      preferencePoints: preferenceMatch(partial, prefs, routeFacts),
    })
    return partial
  })

  return { scored, facts }
}

export async function evaluate(
  origin: LatLng,
  destination: LatLng,
  options: { at?: Date; preferences?: SafetyPreferences } = {},
): Promise<EvaluationResult> {
  const at = options.at ?? new Date()
  const prefs = options.preferences ?? DEFAULT_PREFERENCES

  const routes = await getRoutingProvider().alternatives(origin, destination)
  if (routes.length === 0) {
    throw Object.assign(new Error('no walking route found between these points'), {
      status: 422,
      code: 'NO_ROUTE',
    })
  }

  const { scored, facts } = scoreRoutes(routes, at, prefs)
  const recommendation = decide(scored, prefs)

  return { routes: scored, recommendation, facts, at, modelVersion: MODEL_VERSION }
}
