/**
 * Turning scores into reason codes.
 *
 * This is the only place reason codes are minted. Everything downstream - the
 * "Why this route?" screen, the template engine, the LLM payload - consumes
 * this output and cannot add to it. That is the mechanism behind spec section
 * Gimel's first principle, "the AI explains, it does not decide": by the time
 * any language is generated, the set of true statements is already closed.
 */

import type {
  ReasonCode,
  Route,
  SegmentScore,
  SignalKind,
  StreetContext,
} from '../../shared/types.ts'
import { getSegment } from '../routing/graph.ts'
import { isNight } from './weights.ts'
import { isMeaningfulSegment } from './routeScore.ts'

/** Length-weighted mean of one signal across a route. Null when unknown everywhere. */
function signalMean(
  route: Route,
  scores: Map<string, SegmentScore>,
  kind: SignalKind,
): number | null {
  let weighted = 0
  let covered = 0
  for (const id of route.segmentIds) {
    const score = scores.get(id)
    const lengthM = getSegment(id).lengthM
    const contribution = score?.contributions.find((c) => c.kind === kind)
    if (!contribution) continue
    weighted += contribution.value * lengthM
    covered += lengthM
  }
  return covered === 0 ? null : weighted / covered
}

function contextShare(route: Route, contexts: StreetContext[]): number {
  let matched = 0
  let total = 0
  for (const id of route.segmentIds) {
    const segment = getSegment(id)
    total += segment.lengthM
    if (contexts.includes(segment.context)) matched += segment.lengthM
  }
  return total === 0 ? 0 : matched / total
}

export interface RouteFacts {
  mainStreetShare: number
  activity: number | null
  lighting: number | null
  openPlaces: number | null
  transit: number | null
  hasLiveReport: boolean
  hasIsolatedSegment: boolean
  crossesParkAtNight: boolean
  coverage: number
  /** Most-walked street name, used by explanations as "via X". */
  dominantStreet: string
}

export function describeRoute(
  route: Route,
  segmentScores: SegmentScore[],
  at: Date,
): RouteFacts {
  const scores = new Map(segmentScores.map((s) => [s.segmentId, s]))
  const totalLength = route.segmentIds.reduce((s, id) => s + getSegment(id).lengthM, 0)

  const byStreet = new Map<string, number>()
  let isolated = false
  let park = false
  for (const id of route.segmentIds) {
    const segment = getSegment(id)
    byStreet.set(segment.name, (byStreet.get(segment.name) ?? 0) + segment.lengthM)
    const meaningful = isMeaningfulSegment(segment.lengthM, totalLength)
    if (meaningful && (segment.context === 'isolated_passage' || segment.context === 'parking_lot')) {
      isolated = true
    }
    if (meaningful && segment.context === 'park_path' && isNight(at)) park = true
  }
  const dominantStreet =
    [...byStreet.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''

  const hasLiveReport = route.segmentIds.some((id) =>
    scores.get(id)?.contributions.some((c) => c.kind === 'live_reports'),
  )

  const coverage =
    totalLength === 0
      ? 0
      : route.segmentIds.reduce(
          (sum, id) => sum + (scores.get(id)?.coverage ?? 0) * getSegment(id).lengthM,
          0,
        ) / totalLength

  return {
    mainStreetShare: contextShare(route, ['main_street', 'promenade']),
    activity: signalMean(route, scores, 'human_activity'),
    lighting: signalMean(route, scores, 'lighting'),
    openPlaces: signalMean(route, scores, 'open_places'),
    transit: signalMean(route, scores, 'transit_presence'),
    hasLiveReport,
    hasIsolatedSegment: isolated,
    crossesParkAtNight: park,
    coverage,
    dominantStreet,
  }
}

/** Thresholds for minting a code. Hypotheses, like everything else in the model. */
const T = {
  mainStreetShare: 0.5,
  activityHigh: 0.55,
  activityLow: 0.35,
  lightingHigh: 0.65,
  lightingLow: 0.4,
  openPlacesHigh: 0.45,
  transitHigh: 0.4,
  sparseCoverage: 0.6,
} as const

export function deriveReasonCodes(
  facts: RouteFacts,
  isFastest: boolean,
  at: Date,
): ReasonCode[] {
  const codes: ReasonCode[] = []
  // Street lighting is only a reason worth giving in the dark. Telling someone
  // at 14:00 that a street is well lit is noise, and it crowds out the factors
  // that actually drove the decision.
  const night = isNight(at)

  if (facts.mainStreetShare >= T.mainStreetShare) codes.push('main_street')
  if (facts.activity !== null && facts.activity >= T.activityHigh) codes.push('human_activity')
  if (facts.openPlaces !== null && facts.openPlaces >= T.openPlacesHigh) codes.push('open_places')
  if (facts.transit !== null && facts.transit >= T.transitHigh) codes.push('active_transit')
  if (night && facts.lighting !== null && facts.lighting >= T.lightingHigh) codes.push('well_lit')
  if (isFastest) codes.push('shorter_route')

  if (facts.activity !== null && facts.activity <= T.activityLow) codes.push('low_activity')
  if (night && facts.lighting !== null && facts.lighting <= T.lightingLow) codes.push('poor_lighting')
  if (facts.hasIsolatedSegment) codes.push('isolated_segment')
  if (facts.crossesParkAtNight) codes.push('park_at_night')
  if (facts.hasLiveReport) codes.push('recent_report')

  if (facts.coverage < T.sparseCoverage) codes.push('sparse_data')

  return codes
}
