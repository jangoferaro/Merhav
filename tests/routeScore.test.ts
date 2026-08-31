import { describe, expect, it } from 'vitest'
import type { Route, SegmentScore } from '../shared/types.ts'
import { aggregateRoute, isMeaningfulSegment } from '../server/safety/routeScore.ts'
import { SEGMENTS } from '../server/routing/graph.ts'

function score(segmentId: string, value: number): SegmentScore {
  return {
    segmentId,
    score: value,
    confidence: 0.7,
    coverage: 0.9,
    contributions: [],
    modelVersion: 'test',
  }
}

/** Build a route from real graph segments so lengths are real. */
function routeOf(segmentIds: string[]): Route {
  const distanceM = segmentIds.reduce((s, id) => s + SEGMENTS.get(id)!.lengthM, 0)
  return { id: 'r', segmentIds, geometry: [], distanceM, durationS: Math.round(distanceM / 1.34) }
}

const HERZL_CORRIDOR = [...SEGMENTS.keys()].filter((id) => SEGMENTS.get(id)!.name === 'רחוב הרצל')

describe('aggregateRoute', () => {
  it('a uniform route scores at its segment value', () => {
    const route = routeOf(HERZL_CORRIDOR)
    const result = aggregateRoute(route, HERZL_CORRIDOR.map((id) => score(id, 80)))
    expect(result.safetyScore).toBeCloseTo(80, 1)
  })

  it('does not let a good average hide one bad segment', () => {
    // The exact scenario the spec names in section Het: 95% good segments plus
    // one problematic one must not average out to "fine".
    const route = routeOf(HERZL_CORRIDOR)
    const scores = HERZL_CORRIDOR.map((id, i) => score(id, i === 1 ? 20 : 90))

    const result = aggregateRoute(route, scores)
    const plainMean =
      scores.reduce((s, x) => s + x.score, 0) / scores.length

    expect(result.safetyScore).toBeLessThan(plainMean)
    expect(result.weakestSegment?.score).toBe(20)
  })

  it('applies the 0.65 mean / 0.35 worst formula', () => {
    const route = routeOf(HERZL_CORRIDOR)
    const scores = HERZL_CORRIDOR.map((id, i) => score(id, i === 0 ? 40 : 90))
    const result = aggregateRoute(route, scores)

    const total = route.distanceM
    const mean = HERZL_CORRIDOR.reduce((sum, id, i) => {
      const share = SEGMENTS.get(id)!.lengthM / total
      return sum + (i === 0 ? 40 : 90) * share
    }, 0)
    const expected = 0.65 * mean + 0.35 * 40

    expect(result.safetyScore).toBeCloseTo(expected, 1)
  })

  it('length-weights the mean, so a long segment counts for more', () => {
    const ids = HERZL_CORRIDOR
    const route = routeOf(ids)
    const lengths = ids.map((id) => SEGMENTS.get(id)!.lengthM)
    const longestIndex = lengths.indexOf(Math.max(...lengths))
    const shortestIndex = lengths.indexOf(Math.min(...lengths))

    const longBad = aggregateRoute(route, ids.map((id, i) => score(id, i === longestIndex ? 30 : 90)))
    const shortBad = aggregateRoute(route, ids.map((id, i) => score(id, i === shortestIndex ? 30 : 90)))

    expect(longBad.safetyScore).toBeLessThan(shortBad.safetyScore)
  })

  it('returns a neutral aggregate when there are no scores', () => {
    expect(aggregateRoute(routeOf(HERZL_CORRIDOR), []).safetyScore).toBe(50)
  })
})

describe('isMeaningfulSegment', () => {
  it('accepts a segment above the absolute metre floor', () => {
    expect(isMeaningfulSegment(80, 5000)).toBe(true)
  })

  it('accepts a short segment that is still a large share of a short route', () => {
    expect(isMeaningfulSegment(30, 200)).toBe(true)
  })

  it('rejects a tiny connector inside a long route', () => {
    // Without this, a six-metre link could drive the whole worst-segment term.
    expect(isMeaningfulSegment(6, 2000)).toBe(false)
  })
})
