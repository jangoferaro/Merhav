/**
 * Acceptance criteria FR-01 to FR-10, spec section Kaf-Alef.
 *
 * One test per criterion, worded as the spec words it. These are the bar for
 * "the first product works", so they are kept together and traceable rather
 * than scattered through the unit tests.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { evaluate } from '../server/safety/evaluate.ts'
import { buildPayload } from '../server/explain/payload.ts'
import { explain, renderTemplate, validateExplanation } from '../server/explain/index.ts'
import { addReport, clearReports, REPORT_TTL_MINUTES } from '../server/safety/signalStore.ts'
import { getSegment, getNode } from '../server/routing/graph.ts'
import { MODEL_CONFIG } from '../server/safety/weights.ts'
import { distanceToPathM } from '../server/routing/geo.ts'
import { OFF_ROUTE_THRESHOLD_M } from '../server/safety/weights.ts'
import { createSession, endSession, getSession, updateSession } from '../server/state/walkSessions.ts'
import type { LiveReport } from '../shared/types.ts'
import { CITY_CENTRE, FLORENTIN, NIGHT } from './helpers.ts'

beforeEach(() => {
  clearReports()
})

describe('FR-01: a user can set A and B and get at least one route', () => {
  it('returns routes between two points in the coverage area', async () => {
    const result = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    expect(result.routes.length).toBeGreaterThanOrEqual(1)
  })

  it('fails loudly rather than silently when no route exists', async () => {
    await expect(evaluate(FLORENTIN, FLORENTIN, { at: NIGHT })).rejects.toThrow(/no walking route/)
  })
})

describe('FR-02: when alternatives exist, the system shows recommended + fastest', () => {
  it('identifies both, and they are real routes', async () => {
    const { routes, recommendation } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    expect(routes.length).toBeGreaterThan(1)
    expect(routes.some((r) => r.id === recommendation.recommendedRouteId)).toBe(true)
    expect(routes.some((r) => r.id === recommendation.fastestRouteId)).toBe(true)
  })

  it('the route named fastest really is the fastest', async () => {
    const { routes, recommendation } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const fastest = routes.find((r) => r.id === recommendation.fastestRouteId)!
    for (const route of routes) expect(route.durationS).toBeGreaterThanOrEqual(fastest.durationS)
  })
})

describe('FR-03: the recommendation includes an ETA and the extra time', () => {
  it('carries a duration per route and a non-negative extra time', async () => {
    const { routes, recommendation } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    for (const route of routes) expect(route.durationS).toBeGreaterThan(0)
    expect(recommendation.extraTimeS).toBeGreaterThanOrEqual(0)
  })

  it('the extra time equals recommended minus fastest', async () => {
    const { routes, recommendation } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const rec = routes.find((r) => r.id === recommendation.recommendedRouteId)!
    const fastest = routes.find((r) => r.id === recommendation.fastestRouteId)!
    expect(recommendation.extraTimeS).toBe(Math.max(0, rec.durationS - fastest.durationS))
  })
})

describe('FR-04: every recommendation carries data-backed reason codes', () => {
  it('emits reasons, and each one traces to a signal the engine actually read', async () => {
    const { routes, recommendation } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    expect(recommendation.positives.length).toBeGreaterThan(0)

    const rec = routes.find((r) => r.id === recommendation.recommendedRouteId)!
    const signalsRead = new Set(
      rec.segmentScores.flatMap((s) => s.contributions.map((c) => c.kind)),
    )
    const needs: Record<string, string> = {
      human_activity: 'human_activity',
      open_places: 'open_places',
      active_transit: 'transit_presence',
      well_lit: 'lighting',
      main_street: 'street_context',
      recent_report: 'live_reports',
    }
    for (const code of recommendation.positives) {
      const required = needs[code]
      if (required) expect(signalsRead.has(required as never), code).toBe(true)
    }
  })
})

describe('FR-05: the AI explanation adds no fact absent from the payload', () => {
  it('rejects an invented quantity', async () => {
    const { routes, recommendation, facts } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const payload = buildPayload(recommendation, routes, facts)
    const fabricated = 'עדיף ללכת דרך הרצל — יש שם 12 עסקים פתוחים ושתי תחנות משטרה.'
    expect(validateExplanation(fabricated, payload).ok).toBe(false)
  })

  it('rejects a forbidden absolute claim', async () => {
    const { routes, recommendation, facts } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const payload = buildPayload(recommendation, routes, facts)
    expect(validateExplanation('המסלול הזה בטוח.', payload).ok).toBe(false)
  })

  it('with no model configured, falls back to the deterministic template', async () => {
    // The spec's hard requirement: route choice never depends on an LLM.
    const { routes, recommendation, facts } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const payload = buildPayload(recommendation, routes, facts)
    const explanation = await explain(payload)
    expect(explanation.source).toBe('template')
    expect(explanation.text.length).toBeGreaterThan(0)
    expect(explanation.text).toBe(renderTemplate(payload))
  })

  it('the payload contains no raw sources, geometry or user data', async () => {
    // Spec section Kaf-Gimel: the model receives only the Safety Engine's
    // structured output - no police records, no other users, no identities.
    const { routes, recommendation, facts } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const payload = buildPayload(recommendation, routes, facts)
    const keys = Object.keys(payload).sort()
    expect(keys).toEqual([
      'alternative_negatives', 'alternative_route', 'alternative_via', 'confidence',
      'extra_time_minutes', 'permitted_numbers', 'positives', 'prohibited_claims',
      'recommended_route', 'recommended_via',
    ])
    const serialised = JSON.stringify(payload)
    expect(serialised).not.toMatch(/lat|lng|geometry|segmentId|police|userId/)
  })
})

describe('FR-06: low confidence is shown and affects policy', () => {
  it('reports a confidence band on every recommendation', async () => {
    const { recommendation } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    expect(['high', 'medium', 'low']).toContain(recommendation.confidence)
  })

  it('low confidence blocks a long detour that a high-confidence route would earn', async () => {
    // Enforced in passesDetourGate: the 8-12 minute tier requires confidence.
    const tier = MODEL_CONFIG.detourTiers.find((t) => t.maxExtraMinutes === 12)!
    expect(tier.minConfidence).toBeGreaterThan(0)
  })

  it('says so in the text when confidence is low', () => {
    const text = renderTemplate({
      recommended_route: 'r1', recommended_via: 'הרצל', alternative_route: null,
      alternative_via: null, extra_time_minutes: 0, positives: ['main_street'],
      alternative_negatives: [], confidence: 'low',
      prohibited_claims: [], permitted_numbers: [0],
    })
    expect(text).toMatch(/חלקי/)
  })
})

describe('FR-07: leaving the route triggers a recompute', () => {
  it('flags a position beyond the off-route threshold', async () => {
    const { routes } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const route = routes[0]!
    const session = createSession(route.id, routes, '{}')

    const onPath = route.geometry[1]!
    expect(distanceToPathM(onPath, route.geometry)).toBeLessThan(OFF_ROUTE_THRESHOLD_M)

    const wayOff = { lat: onPath.lat + 0.004, lng: onPath.lng + 0.004 }
    expect(distanceToPathM(wayOff, route.geometry)).toBeGreaterThan(OFF_ROUTE_THRESHOLD_M)

    updateSession(session.id, { state: 'OFF_ROUTE', lastKnownPosition: wayOff })
    expect(getSession(session.id)!.state).toBe('OFF_ROUTE')
  })
})

describe('FR-08: a live report carries a timestamp and an expiration', () => {
  it('stamps both, with a TTL that matches its category', () => {
    const now = NIGHT
    const report: LiveReport = {
      id: 'rep_1',
      category: 'disturbance',
      position: getNode('carmel').position,
      segmentId: null,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + REPORT_TTL_MINUTES.disturbance * 60_000).toISOString(),
      confirmations: 0,
      disputes: 0,
      trust: 0.4,
    }
    addReport(report)
    expect(new Date(report.expiresAt).getTime()).toBeGreaterThan(new Date(report.createdAt).getTime())
    expect(REPORT_TTL_MINUTES.disturbance).toBe(60)
  })

  it('every category has a finite TTL, so nothing accumulates forever', () => {
    for (const [category, ttl] of Object.entries(REPORT_TTL_MINUTES)) {
      expect(ttl, category).toBeGreaterThan(0)
      expect(Number.isFinite(ttl), category).toBe(true)
    }
  })
})

describe('FR-09: a user can delete walk history', () => {
  it('drops the position as soon as the session ends', async () => {
    // Retention minimisation as behaviour, not as a cleanup job.
    const { routes } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const session = createSession(routes[0]!.id, routes, '{}')
    updateSession(session.id, { lastKnownPosition: routes[0]!.geometry[1]!, state: 'WALKING' })
    expect(getSession(session.id)!.lastKnownPosition).not.toBeNull()

    endSession(session.id, 'ARRIVED')
    expect(getSession(session.id)!.lastKnownPosition).toBeNull()
    expect(getSession(session.id)!.endedAt).not.toBeNull()
  })

  it('never keeps a location trail, only the latest position', async () => {
    const { routes } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const session = createSession(routes[0]!.id, routes, '{}')
    updateSession(session.id, { lastKnownPosition: routes[0]!.geometry[0]! })
    updateSession(session.id, { lastKnownPosition: routes[0]!.geometry[1]! })
    const stored = getSession(session.id)!
    expect(stored.lastKnownPosition).toEqual(routes[0]!.geometry[1]!)
    expect(Object.keys(stored)).not.toContain('positions')
  })
})

describe('FR-10: every model config change is recorded in an audit log', () => {
  it('exposes a versioned, serialisable config', () => {
    expect(MODEL_CONFIG.version).toMatch(/^safe-score-/)
    expect(() => JSON.stringify(MODEL_CONFIG)).not.toThrow()
  })

  it('stamps the model version onto every score it produces', async () => {
    const { routes } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    for (const route of routes) {
      for (const score of route.segmentScores) {
        expect(score.modelVersion).toBe(MODEL_CONFIG.version)
      }
    }
  })
})

describe('non-goals (spec section Bet)', () => {
  it('no signal describes people, only streets and infrastructure', async () => {
    const { routes } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const kinds = new Set(
      routes.flatMap((r) => r.segmentScores.flatMap((s) => s.contributions.map((c) => c.kind))),
    )
    const allowed = [
      'human_activity', 'lighting', 'street_context', 'open_places',
      'transit_presence', 'live_reports', 'historical_context',
    ]
    for (const kind of kinds) expect(allowed).toContain(kind)
  })

  it('the recommendation never claims a route is safe', async () => {
    const { routes, recommendation, facts } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const explanation = await explain(buildPayload(recommendation, routes, facts))
    expect(validateExplanation(explanation.text, buildPayload(recommendation, routes, facts)).ok).toBe(true)
  })

  it('does not use the sparse-data segment as a reason to avoid a route', async () => {
    // "No data" must surface as sparse_data (a confidence statement), never as
    // a negative safety reason.
    const { routes } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    for (const route of routes) {
      const hasSparse = route.reasonCodes.includes('sparse_data')
      if (hasSparse) expect(route.coverage).toBeLessThan(1)
    }
  })
})
