import { describe, expect, it } from 'vitest'
import {
  DAY_WEIGHTS,
  NIGHT_WEIGHTS,
  ROUTE_MEAN_WEIGHT,
  ROUTE_WORST_WEIGHT,
  STREET_CONTEXT_VALUE,
  isNight,
  weightsFor,
} from '../server/safety/weights.ts'

describe('model configuration', () => {
  it('each weight profile sums to exactly 1', () => {
    // If a profile drifts off 1, coverage stops meaning "share of the weight
    // budget we have data for" and confidence silently becomes wrong.
    const sum = (w: Record<string, number>) =>
      Math.round(Object.values(w).reduce((a, b) => a + b, 0) * 1000) / 1000
    expect(sum(NIGHT_WEIGHTS)).toBe(1)
    expect(sum(DAY_WEIGHTS)).toBe(1)
  })

  it('route aggregation weights sum to 1', () => {
    expect(ROUTE_MEAN_WEIGHT + ROUTE_WORST_WEIGHT).toBeCloseTo(1, 10)
  })

  it('weights lighting and human presence more heavily at night', () => {
    expect(NIGHT_WEIGHTS.lighting).toBeGreaterThan(DAY_WEIGHTS.lighting)
    expect(NIGHT_WEIGHTS.human_activity).toBeGreaterThan(DAY_WEIGHTS.human_activity)
  })

  it('treats 20:00 to 06:00 as night', () => {
    expect(isNight(new Date('2026-08-31T01:42:00'))).toBe(true)
    expect(isNight(new Date('2026-08-31T21:00:00'))).toBe(true)
    expect(isNight(new Date('2026-08-31T14:00:00'))).toBe(false)
    expect(isNight(new Date('2026-08-31T06:00:00'))).toBe(false)
  })

  it('selects the profile matching the hour', () => {
    expect(weightsFor(new Date('2026-08-31T01:42:00'))).toBe(NIGHT_WEIGHTS)
    expect(weightsFor(new Date('2026-08-31T14:00:00'))).toBe(DAY_WEIGHTS)
  })

  it('ranks an isolated passage below a main street', () => {
    expect(STREET_CONTEXT_VALUE.isolated_passage).toBeLessThan(
      STREET_CONTEXT_VALUE.main_street,
    )
  })

  it('every street context has a value in 0..1', () => {
    for (const [context, value] of Object.entries(STREET_CONTEXT_VALUE)) {
      expect(value, context).toBeGreaterThanOrEqual(0)
      expect(value, context).toBeLessThanOrEqual(1)
    }
  })
})
