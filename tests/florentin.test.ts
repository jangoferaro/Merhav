/**
 * The worked scenario from spec section Kaf-Gimel: 01:42 in Florentin.
 *
 * The document walks through it step by step - three routes at thirteen,
 * sixteen and twenty minutes; the middle one wins; a five-point gap does not
 * buy four more minutes; the explanation names the street and the extra time.
 * This test holds the whole pipeline to that narrative, so a change in the
 * weights or the policy that quietly breaks the product's own headline example
 * fails here rather than in a demo.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { evaluate } from '../server/safety/evaluate.ts'
import { buildPayload } from '../server/explain/payload.ts'
import { explain } from '../server/explain/index.ts'
import { clearReports, addReport } from '../server/safety/signalStore.ts'
import { getNode, SEGMENTS } from '../server/routing/graph.ts'
import { findViolations } from '../shared/guardrails.ts'
import { CITY_CENTRE, FLORENTIN, NIGHT, AFTERNOON } from './helpers.ts'

beforeEach(() => clearReports())

const minutes = (s: number) => s / 60

describe('01:42 in Florentin', () => {
  it('offers three alternatives at roughly 13, 16 and 20 minutes', async () => {
    const { routes } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    expect(routes).toHaveLength(3)
    const durations = routes.map((r) => Math.round(minutes(r.durationS)))
    expect(durations).toEqual([13, 16, 20])
  })

  it('the short route runs through quiet streets, the middle one down a main street', async () => {
    const { routes } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const [short, middle] = routes
    const contexts = (ids: string[]) => ids.map((id) => SEGMENTS.get(id)!.context)

    expect(contexts(short!.segmentIds)).toContain('residential')
    expect(contexts(middle!.segmentIds).every((c) => c === 'main_street')).toBe(true)
  })

  it('scores the main-street route above the quiet short one', async () => {
    const { routes } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const [short, middle] = routes
    expect(middle!.safetyScore).toBeGreaterThan(short!.safetyScore)
  })

  it('recommends the sixteen-minute route, not the twenty-minute one', async () => {
    // The spec's own reasoning: the long route scores slightly higher, but a
    // small gap does not justify four more minutes of walking.
    const { routes, recommendation } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const middle = routes[1]!
    expect(recommendation.recommendedRouteId).toBe(middle.id)
    expect(Math.round(minutes(recommendation.extraTimeS))).toBe(3)
  })

  it('gives the reasons the spec expects: main street, open places, low activity on the alternative', async () => {
    const { routes, recommendation, facts } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const payload = buildPayload(recommendation, routes, facts)
    expect(payload.positives).toContain('main_street')
    expect(payload.positives).toContain('open_places')
    expect(payload.alternative_negatives).toContain('low_activity')
  })

  it('produces a short explanation naming the street and the extra time', async () => {
    const { routes, recommendation, facts } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const payload = buildPayload(recommendation, routes, facts)
    const explanation = await explain(payload)

    expect(explanation.text).toContain(payload.recommended_via)
    expect(explanation.text).toContain('3')
    expect(explanation.text.length).toBeLessThanOrEqual(420)
    expect(findViolations(explanation.text)).toHaveLength(0)
  })

  it('records why the twenty-minute route was passed over', async () => {
    const { recommendation } = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    expect(recommendation.policyNote.length).toBeGreaterThan(0)
    expect(recommendation.policyNote).toMatch(/chose/)
  })
})

describe('the same trip in daylight', () => {
  it('reaches a different conclusion, because the hour is part of the address', async () => {
    // Spec section Gimel: "the same segment can have a different context at
    // 14:00 and at 02:30."
    const night = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const day = await evaluate(FLORENTIN, CITY_CENTRE, { at: AFTERNOON })

    const nightShort = night.routes[0]!
    const dayShort = day.routes[0]!
    expect(nightShort.id).toBe(dayShort.id)
    expect(nightShort.safetyScore).not.toBeCloseTo(dayShort.safetyScore, 1)
  })

  it('stops citing street lighting as a reason in daylight', async () => {
    const night = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const day = await evaluate(FLORENTIN, CITY_CENTRE, { at: AFTERNOON })
    const rec = (r: typeof night) => r.routes.find((x) => x.id === r.recommendation.recommendedRouteId)!

    expect(rec(night).reasonCodes).toContain('well_lit')
    expect(rec(day).reasonCodes).not.toContain('well_lit')
  })
})

describe('a fresh report mid-walk', () => {
  it('lowers the score of the segment it lands on', async () => {
    const before = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const middle = before.routes[1]!
    const target = middle.segmentIds[1]!

    addReport({
      id: 'rep_scenario',
      category: 'disturbance',
      position: getNode('carmel').position,
      segmentId: target,
      createdAt: new Date(NIGHT.getTime() - 4 * 60_000).toISOString(),
      expiresAt: new Date(NIGHT.getTime() + 56 * 60_000).toISOString(),
      confirmations: 2,
      disputes: 0,
      trust: 0.7,
    })

    const after = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const scoreOf = (r: typeof before, id: string) =>
      r.routes.flatMap((x) => x.segmentScores).find((s) => s.segmentId === id)!.score

    expect(scoreOf(after, target)).toBeLessThan(scoreOf(before, target))
  })

  it('surfaces the report as a reason code on the affected route', async () => {
    const before = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const target = before.routes[1]!.segmentIds[1]!

    addReport({
      id: 'rep_scenario_2',
      category: 'disturbance',
      position: getNode('carmel').position,
      segmentId: target,
      createdAt: new Date(NIGHT.getTime() - 4 * 60_000).toISOString(),
      expiresAt: new Date(NIGHT.getTime() + 56 * 60_000).toISOString(),
      confirmations: 2,
      disputes: 0,
      trust: 0.7,
    })

    const after = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    expect(after.routes[1]!.reasonCodes).toContain('recent_report')
  })

  it('an expired report has no effect at all', async () => {
    const before = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    const target = before.routes[1]!.segmentIds[1]!

    addReport({
      id: 'rep_expired',
      category: 'disturbance',
      position: getNode('carmel').position,
      segmentId: target,
      createdAt: new Date(NIGHT.getTime() - 180 * 60_000).toISOString(),
      expiresAt: new Date(NIGHT.getTime() - 120 * 60_000).toISOString(),
      confirmations: 5,
      disputes: 0,
      trust: 0.9,
    })

    const after = await evaluate(FLORENTIN, CITY_CENTRE, { at: NIGHT })
    expect(after.routes[1]!.safetyScore).toBe(before.routes[1]!.safetyScore)
  })
})
