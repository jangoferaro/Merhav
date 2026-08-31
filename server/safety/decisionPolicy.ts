/**
 * Decision policy - the component that actually picks a route.
 *
 * Spec section Zayin:
 *   Utility(route) = SafetyBenefit - DetourPenalty - UncertaintyPenalty + PreferenceMatch
 *   "The algorithm does not look for a maximum safety score at any cost; it
 *    looks for a meaningful improvement relative to time and certainty."
 *
 * Two independent mechanisms, both required:
 *   1. Utility ranking, which trades safety against time continuously.
 *   2. A detour GATE (section Zayin's table), which a winner must also pass.
 * Utility alone would happily sell a fourteen-minute detour for a large score
 * gain; the gate is what stops that.
 */

import type {
  ReasonCode,
  Recommendation,
  SafetyPreferences,
  ScoredRoute,
} from '../../shared/types.ts'
import { DEFAULT_PREFERENCES } from '../../shared/types.ts'
import { confidenceBand } from './confidence.ts'
import { reasonsByPolarity } from '../../shared/reasonCodes.ts'
import {
  DETOUR_COST_BREAKPOINTS,
  DETOUR_TIERS,
  MAX_DETOUR_MINUTES,
  NEGLIGIBLE_SAFETY_DELTA,
  UNCERTAINTY_PENALTY_POINTS,
} from './weights.ts'

/**
 * Convex cost of extra walking time, in SAFE-score points.
 *
 * Convex on purpose: the first few minutes are cheap, later ones are not, so
 * the policy naturally prefers a small detour with a decent gain over a large
 * detour with a slightly bigger one.
 */
export function detourPenalty(extraMinutes: number): number {
  if (extraMinutes <= 0) return 0
  let remaining = extraMinutes
  let previousCap = 0
  let cost = 0
  for (const tier of DETOUR_COST_BREAKPOINTS) {
    const span = Math.min(remaining, tier.upToMinutes - previousCap)
    if (span > 0) {
      cost += span * tier.perMinute
      remaining -= span
    }
    previousCap = tier.upToMinutes
    if (remaining <= 0) break
  }
  return cost
}

/** How well a route matches what the user asked for, in SAFE-score points. */
export function preferenceMatch(
  route: ScoredRoute,
  prefs: SafetyPreferences,
  facts: { mainStreetShare: number; openPlaces: number | null; lighting: number | null; crossesParkAtNight: boolean },
): number {
  const level = (l: 'low' | 'normal' | 'high') => (l === 'high' ? 1 : l === 'normal' ? 0.4 : 0)
  let points = 0
  points += level(prefs.preferMainStreets) * 8 * facts.mainStreetShare
  points += level(prefs.preferOpenPlaces) * 6 * (facts.openPlaces ?? 0)
  points += level(prefs.preferLitRoutes) * 6 * (facts.lighting ?? 0)
  if (prefs.avoidParksAtNight && facts.crossesParkAtNight) points -= 12
  void route
  return points
}

export interface UtilityInput {
  route: ScoredRoute
  extraMinutes: number
  preferencePoints: number
}

export function computeUtility(input: UtilityInput): number {
  const { route, extraMinutes, preferencePoints } = input
  const safetyBenefit = route.safetyScore
  const uncertainty = (1 - route.confidence) * UNCERTAINTY_PENALTY_POINTS
  return (
    Math.round(
      (safetyBenefit - detourPenalty(extraMinutes) - uncertainty + preferencePoints) * 10,
    ) / 10
  )
}

/** The user's own cap on detour length, in minutes. */
export function detourCeiling(prefs: SafetyPreferences): number {
  return prefs.maxDetourMinutes === 'auto' ? MAX_DETOUR_MINUTES : prefs.maxDetourMinutes
}

export interface GateResult {
  passes: boolean
  reason: string
}

/**
 * Spec section Zayin's detour table, applied to a candidate against the
 * fastest route:
 *   0-3 min   a moderate improvement is enough
 *   4-7 min   a clear improvement is required
 *   8-12 min  only when the improvement is large AND confidence is high
 *   >12 min   not by default
 */
export function passesDetourGate(
  candidate: ScoredRoute,
  fastest: ScoredRoute,
  prefs: SafetyPreferences,
): GateResult {
  if (candidate.id === fastest.id) return { passes: true, reason: 'candidate is the fastest route' }

  const extraMinutes = (candidate.durationS - fastest.durationS) / 60
  const gain = candidate.safetyScore - fastest.safetyScore

  const ceiling = detourCeiling(prefs)
  if (extraMinutes > ceiling) {
    return {
      passes: false,
      reason: `detour of ${extraMinutes.toFixed(1)}min exceeds the ${ceiling}min ceiling`,
    }
  }

  const tier = DETOUR_TIERS.find((t) => extraMinutes <= t.maxExtraMinutes)
  if (!tier) {
    return { passes: false, reason: `detour of ${extraMinutes.toFixed(1)}min is beyond every tier` }
  }

  if (gain < tier.minSafetyGain) {
    return {
      passes: false,
      reason: `gain of ${gain.toFixed(1)} points is below the ${tier.minSafetyGain} required for a ${extraMinutes.toFixed(1)}min detour`,
    }
  }
  if (candidate.confidence < tier.minConfidence) {
    return {
      passes: false,
      reason: `confidence ${candidate.confidence.toFixed(2)} is below the ${tier.minConfidence} required for a ${extraMinutes.toFixed(1)}min detour`,
    }
  }
  return {
    passes: true,
    reason: `gain of ${gain.toFixed(1)} points justifies a ${extraMinutes.toFixed(1)}min detour`,
  }
}

/**
 * Guards the coupling the negligible-difference rule depends on.
 *
 * `decide` relies on the first detour tier already rejecting anything whose
 * advantage is negligible. If someone lowers that tier's threshold below
 * NEGLIGIBLE_SAFETY_DELTA, the product would start recommending detours for
 * differences it simultaneously describes as meaningless. Called once at
 * module load, so a bad config fails at boot rather than in front of a user.
 */
export function assertNegligibleRuleIsEnforced(): void {
  const firstTier = DETOUR_TIERS[0]
  if (firstTier.minSafetyGain < NEGLIGIBLE_SAFETY_DELTA) {
    throw new Error(
      `model config is inconsistent: the first detour tier requires only ` +
        `${firstTier.minSafetyGain} points, but ${NEGLIGIBLE_SAFETY_DELTA} is ` +
        `the threshold below which a difference is called negligible`,
    )
  }
}

assertNegligibleRuleIsEnforced()

/**
 * Choose the recommendation.
 *
 * `routes` must already carry safetyScore, confidence, utility and reasonCodes.
 */
export function decide(
  routes: ScoredRoute[],
  prefs: SafetyPreferences = DEFAULT_PREFERENCES,
): Recommendation {
  if (routes.length === 0) throw new Error('decide() called with no routes')

  const fastest = [...routes].sort((a, b) => a.durationS - b.durationS)[0]!
  const byUtility = [...routes].sort((a, b) => b.utility - a.utility)

  // Walk down the utility ranking and take the first candidate that also
  // clears the detour gate. Every rejection is kept: the audit log in spec
  // section Tet-Zayin is only useful if it records what was NOT chosen and
  // why, not just the winner.
  const rejections: string[] = []
  let chosen = fastest
  let chosenNote = `chose ${fastest.id} by default (no alternative cleared the detour gate)`

  for (const candidate of byUtility) {
    const gate = passesDetourGate(candidate, fastest, prefs)
    if (gate.passes) {
      chosen = candidate
      chosenNote = `chose ${candidate.id} (utility ${candidate.utility}); ${gate.reason}`
      break
    }
    rejections.push(`rejected ${candidate.id}: ${gate.reason}`)
  }

  const extraTimeS = Math.max(0, chosen.durationS - fastest.durationS)

  // The alternative we are arguing against: the fastest route when we
  // detoured, otherwise the best option we passed over.
  const alternative =
    chosen.id === fastest.id
      ? byUtility.find((r) => r.id !== chosen.id) ?? null
      : fastest

  /*
   * Spec section Yod: "if the difference is negligible, say there is no
   * meaningful advantage and prefer the faster route."
   *
   * There is no separate fallback here, because there cannot be one: the
   * first detour tier already requires a gain of at least
   * NEGLIGIBLE_SAFETY_DELTA, so nothing with a negligible advantage can ever
   * clear the gate. What is left to do is TELL the user that - which is what
   * this meta code is for. `assertNegligibleRuleIsEnforced` below keeps the
   * two thresholds from drifting apart and quietly reopening the hole.
   */
  const negligible =
    chosen.id === fastest.id &&
    alternative !== null &&
    alternative.safetyScore - fastest.safetyScore < NEGLIGIBLE_SAFETY_DELTA

  const positives = reasonsByPolarity(chosen.reasonCodes, 'positive')
  const alternativeNegatives = alternative
    ? reasonsByPolarity(alternative.reasonCodes, 'negative')
    : []

  const metaCodes: ReasonCode[] = []
  if (chosen.reasonCodes.includes('sparse_data')) metaCodes.push('sparse_data')
  if (negligible) metaCodes.push('negligible_difference')

  const policyNote = [...rejections, chosenNote].join(' | ')

  return {
    recommendedRouteId: chosen.id,
    fastestRouteId: fastest.id,
    extraTimeS,
    confidence: confidenceBand(chosen.confidence),
    positives: [...positives, ...metaCodes],
    alternativeNegatives,
    policyNote,
  }
}
