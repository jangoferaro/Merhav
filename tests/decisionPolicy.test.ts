import { describe, expect, it } from 'vitest'
import type { SafetyPreferences, ScoredRoute } from '../shared/types.ts'
import { DEFAULT_PREFERENCES } from '../shared/types.ts'
import {
  assertNegligibleRuleIsEnforced,
  decide,
  detourPenalty,
  passesDetourGate,
  preferenceMatch,
} from '../server/safety/decisionPolicy.ts'
import { DETOUR_TIERS, NEGLIGIBLE_SAFETY_DELTA } from '../server/safety/weights.ts'

function route(over: Partial<ScoredRoute> & Pick<ScoredRoute, 'id' | 'durationS' | 'safetyScore'>): ScoredRoute {
  return {
    segmentIds: [],
    geometry: [],
    distanceM: over.durationS * 1.34,
    confidence: 0.8,
    coverage: 0.9,
    weakestSegment: null,
    segmentScores: [],
    utility: over.safetyScore,
    reasonCodes: [],
    ...over,
  }
}

describe('detourPenalty', () => {
  it('costs nothing when there is no detour', () => {
    expect(detourPenalty(0)).toBe(0)
    expect(detourPenalty(-2)).toBe(0)
  })

  it('is convex: later minutes cost more than earlier ones', () => {
    const first3 = detourPenalty(3)
    const next3 = detourPenalty(6) - detourPenalty(3)
    const another3 = detourPenalty(9) - detourPenalty(6)
    expect(next3).toBeGreaterThan(first3)
    expect(another3).toBeGreaterThan(next3)
  })

  it('makes a detour beyond twelve minutes prohibitively expensive', () => {
    expect(detourPenalty(15)).toBeGreaterThan(60)
  })
})

describe('passesDetourGate', () => {
  const fastest = route({ id: 'fast', durationS: 600, safetyScore: 50 })

  it('allows a short detour for a moderate improvement', () => {
    // 0-3 minutes: "a moderate improvement is enough" (spec section Zayin).
    const candidate = route({ id: 'alt', durationS: 600 + 2 * 60, safetyScore: 56 })
    expect(passesDetourGate(candidate, fastest, DEFAULT_PREFERENCES).passes).toBe(true)
  })

  it('rejects a short detour for a trivial improvement', () => {
    const candidate = route({ id: 'alt', durationS: 600 + 2 * 60, safetyScore: 52 })
    expect(passesDetourGate(candidate, fastest, DEFAULT_PREFERENCES).passes).toBe(false)
  })

  it('requires a clear improvement for a four-to-seven minute detour', () => {
    const weak = route({ id: 'alt', durationS: 600 + 5 * 60, safetyScore: 57 })
    const strong = route({ id: 'alt', durationS: 600 + 5 * 60, safetyScore: 65 })
    expect(passesDetourGate(weak, fastest, DEFAULT_PREFERENCES).passes).toBe(false)
    expect(passesDetourGate(strong, fastest, DEFAULT_PREFERENCES).passes).toBe(true)
  })

  it('requires high confidence as well as a large gain for an eight-to-twelve minute detour', () => {
    const unsure = route({ id: 'alt', durationS: 600 + 10 * 60, safetyScore: 75, confidence: 0.5 })
    const sure = route({ id: 'alt', durationS: 600 + 10 * 60, safetyScore: 75, confidence: 0.8 })
    expect(passesDetourGate(unsure, fastest, DEFAULT_PREFERENCES).passes).toBe(false)
    expect(passesDetourGate(sure, fastest, DEFAULT_PREFERENCES).passes).toBe(true)
  })

  it('never recommends a detour beyond twelve minutes by default', () => {
    // However large the improvement. Spec section Zayin: "not as a default;
    // offer the user a 'more cautious' choice instead."
    const huge = route({ id: 'alt', durationS: 600 + 20 * 60, safetyScore: 100, confidence: 1 })
    expect(passesDetourGate(huge, fastest, DEFAULT_PREFERENCES).passes).toBe(false)
  })

  it('honours a stricter user ceiling', () => {
    const prefs: SafetyPreferences = { ...DEFAULT_PREFERENCES, maxDetourMinutes: 3 }
    const candidate = route({ id: 'alt', durationS: 600 + 5 * 60, safetyScore: 70 })
    expect(passesDetourGate(candidate, fastest, prefs).passes).toBe(false)
    expect(passesDetourGate(candidate, fastest, DEFAULT_PREFERENCES).passes).toBe(true)
  })
})

describe('preferenceMatch', () => {
  const base = { mainStreetShare: 1, openPlaces: 1, lighting: 1, crossesParkAtNight: false }

  it('rewards main streets more when the user asked for them', () => {
    const high = preferenceMatch(route({ id: 'a', durationS: 1, safetyScore: 1 }), { ...DEFAULT_PREFERENCES, preferMainStreets: 'high' }, base)
    const low = preferenceMatch(route({ id: 'a', durationS: 1, safetyScore: 1 }), { ...DEFAULT_PREFERENCES, preferMainStreets: 'low' }, base)
    expect(high).toBeGreaterThan(low)
  })

  it('penalises a park crossing at night when the user opted out of it', () => {
    const r = route({ id: 'a', durationS: 1, safetyScore: 1 })
    const withPark = preferenceMatch(r, DEFAULT_PREFERENCES, { ...base, crossesParkAtNight: true })
    const without = preferenceMatch(r, DEFAULT_PREFERENCES, base)
    expect(withPark).toBeLessThan(without)
  })
})

describe('decide', () => {
  it('recommends the fastest route when nothing beats it', () => {
    const routes = [
      route({ id: 'a', durationS: 600, safetyScore: 70, utility: 70 }),
      route({ id: 'b', durationS: 900, safetyScore: 72, utility: 60 }),
    ]
    const decision = decide(routes)
    expect(decision.recommendedRouteId).toBe('a')
    expect(decision.fastestRouteId).toBe('a')
    expect(decision.extraTimeS).toBe(0)
  })

  it('falls back to the fastest route when the difference is negligible', () => {
    // Spec section Yod: "if the difference is negligible, say there is no
    // meaningful advantage and prefer the faster route."
    const routes = [
      route({ id: 'a', durationS: 600, safetyScore: 70, utility: 68 }),
      route({ id: 'b', durationS: 700, safetyScore: 72, utility: 69 }),
    ]
    const decision = decide(routes)
    expect(decision.recommendedRouteId).toBe('a')
    expect(decision.positives).toContain('negligible_difference')
    expect(decision.policyNote).toMatch(/rejected b/)
  })

  it('recommends a detour when it clears both the utility ranking and the gate', () => {
    const routes = [
      route({ id: 'a', durationS: 600, safetyScore: 45, utility: 45 }),
      route({ id: 'b', durationS: 720, safetyScore: 78, utility: 74 }),
    ]
    const decision = decide(routes)
    expect(decision.recommendedRouteId).toBe('b')
    expect(decision.extraTimeS).toBe(120)
  })

  it('rejects a high-utility route that fails the detour gate and records why', () => {
    const routes = [
      route({ id: 'a', durationS: 600, safetyScore: 50, utility: 50 }),
      route({ id: 'b', durationS: 600 + 20 * 60, safetyScore: 99, utility: 99 }),
    ]
    const decision = decide(routes)
    expect(decision.recommendedRouteId).toBe('a')
    // The rejection must survive into the note - otherwise the audit log only
    // ever shows the winner, and "why not the safer one?" is unanswerable.
    expect(decision.policyNote).toMatch(/rejected b/)
    expect(decision.policyNote).toMatch(/ceiling|beyond every tier/)
  })

  it('reports extra time relative to the fastest route, never negative', () => {
    const routes = [
      route({ id: 'a', durationS: 900, safetyScore: 80, utility: 80 }),
      route({ id: 'b', durationS: 600, safetyScore: 40, utility: 40 }),
    ]
    expect(decide(routes).extraTimeS).toBe(300)
  })

  it('throws rather than guessing when given no routes', () => {
    expect(() => decide([])).toThrow(/no routes/)
  })

  it('cannot recommend a detour it would also call negligible', () => {
    // The two thresholds are separately configurable, so assert the coupling
    // rather than trusting that nobody edits one of them.
    expect(DETOUR_TIERS[0].minSafetyGain).toBeGreaterThanOrEqual(NEGLIGIBLE_SAFETY_DELTA)
    expect(() => assertNegligibleRuleIsEnforced()).not.toThrow()
  })
})
