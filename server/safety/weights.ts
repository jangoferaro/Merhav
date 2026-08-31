/**
 * SAFE Score model configuration.
 *
 * Every number here is a HYPOTHESIS, exactly as the spec insists in section
 * Het: "the weights are a hypothesis only; they must be calibrated with usage
 * data, professional validation, user research and outcome measures that do
 * not create bias." Nothing in this file is a safety finding.
 *
 * The whole config is versioned and exported as one object so that
 * spec section Tet-Zayin ("weight/threshold changes must be versioned,
 * auditable and rollback-able; never hand-edit a production model") has
 * something concrete to version.
 */

import type { SignalKind, StreetContext } from '../../shared/types.ts'
import { cityHour } from './cityTime.ts'

export const MODEL_VERSION = 'safe-score-0.1.0-phase0'

export type WeightSet = Record<SignalKind, number>

/**
 * Day and night weight profiles. Spec section Kaf-Alef lists "which signals
 * get weight by day versus by night?" as an open question to close before
 * build - this is the first answer, expressed as config so it can be A/B
 * tested rather than argued about.
 *
 * At night, lighting and human presence matter more and static historical
 * context matters less; by day the street's own character and open places
 * carry more of the signal.
 */
export const NIGHT_WEIGHTS: WeightSet = {
  human_activity: 0.28,
  lighting: 0.24,
  street_context: 0.14,
  open_places: 0.1,
  transit_presence: 0.08,
  live_reports: 0.1,
  historical_context: 0.06,
}

export const DAY_WEIGHTS: WeightSet = {
  human_activity: 0.2,
  lighting: 0.08,
  street_context: 0.18,
  open_places: 0.14,
  transit_presence: 0.12,
  live_reports: 0.12,
  historical_context: 0.16,
}

/** Night runs 20:00-06:00 city-local, never server-local. */
export function isNight(at: Date): boolean {
  const h = cityHour(at)
  return h >= 20 || h < 6
}

export function weightsFor(at: Date): WeightSet {
  return isNight(at) ? NIGHT_WEIGHTS : DAY_WEIGHTS
}

/**
 * Street character mapped to a 0..1 signal value.
 *
 * This encodes properties of the ROAD - width, through-traffic, frontage,
 * enclosure. It must never encode anything about who lives on or walks down
 * it (spec section Het: "protected demographic attributes of an area or of
 * people must not be used as a signal").
 */
export const STREET_CONTEXT_VALUE: Record<StreetContext, number> = {
  main_street: 0.85,
  promenade: 0.8,
  secondary_street: 0.65,
  residential: 0.55,
  park_path: 0.38,
  alley: 0.35,
  parking_lot: 0.25,
  isolated_passage: 0.15,
}

/**
 * Route aggregation, spec section Het: "the route score is a function of the
 * sequence of segments; a significant weak point should be penalised, not
 * just averaged."
 *
 *   Route = 0.65 * length-weighted mean + 0.35 * worst meaningful segment
 */
export const ROUTE_MEAN_WEIGHT = 0.65
export const ROUTE_WORST_WEIGHT = 0.35

/**
 * A segment counts as "meaningful" for the worst-segment term when it is at
 * least this share of the route, or this many metres. Without a floor, a 6 m
 * connector could dominate the whole route score.
 */
export const MEANINGFUL_SEGMENT_SHARE = 0.05
export const MEANINGFUL_SEGMENT_MIN_M = 40

/** Confidence band cut-offs, spec section Yod-Gimel. */
export const CONFIDENCE_HIGH = 0.7
export const CONFIDENCE_MEDIUM = 0.45

/**
 * Detour policy, spec section Zayin. The document is explicit that these
 * numbers "are a starting point for user research / A-B testing and are not a
 * proven safety conclusion."
 */
export const DETOUR_TIERS = [
  { maxExtraMinutes: 3, minSafetyGain: 4, minConfidence: 0 },
  { maxExtraMinutes: 7, minSafetyGain: 10, minConfidence: 0.45 },
  { maxExtraMinutes: 12, minSafetyGain: 18, minConfidence: 0.7 },
] as const

/** Beyond the last tier, no detour is recommended by default. */
export const MAX_DETOUR_MINUTES = 12

/** Convex cost of extra walking time, in SAFE-score points per minute. */
export const DETOUR_COST_BREAKPOINTS = [
  { upToMinutes: 3, perMinute: 1.5 },
  { upToMinutes: 7, perMinute: 3.0 },
  { upToMinutes: 12, perMinute: 5.0 },
  { upToMinutes: Infinity, perMinute: 12.0 },
] as const

/** How hard low confidence pulls a route's utility down. */
export const UNCERTAINTY_PENALTY_POINTS = 15

/**
 * Below this improvement the product should stop arguing and just send the
 * user the short way (spec section Yod: "if the difference is negligible, say
 * there is no meaningful advantage and prefer the faster route").
 */
export const NEGLIGIBLE_SAFETY_DELTA = 4

/** Live navigation: re-routing hysteresis, spec section Yod-Alef. */
export const REROUTE_MIN_SAFETY_GAIN = 8
export const REROUTE_MAX_EXTRA_MINUTES = 5
export const OFF_ROUTE_THRESHOLD_M = 45

export const MODEL_CONFIG = {
  version: MODEL_VERSION,
  nightWeights: NIGHT_WEIGHTS,
  dayWeights: DAY_WEIGHTS,
  streetContextValue: STREET_CONTEXT_VALUE,
  routeMeanWeight: ROUTE_MEAN_WEIGHT,
  routeWorstWeight: ROUTE_WORST_WEIGHT,
  detourTiers: DETOUR_TIERS,
  maxDetourMinutes: MAX_DETOUR_MINUTES,
  uncertaintyPenaltyPoints: UNCERTAINTY_PENALTY_POINTS,
  negligibleSafetyDelta: NEGLIGIBLE_SAFETY_DELTA,
  rerouteMinSafetyGain: REROUTE_MIN_SAFETY_GAIN,
  offRouteThresholdM: OFF_ROUTE_THRESHOLD_M,
} as const
