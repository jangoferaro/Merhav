import { describe, expect, it } from 'vitest'
import type { SegmentFeature } from '../shared/types.ts'
import { scoreSegment } from '../server/safety/segmentScore.ts'
import { NIGHT } from './helpers.ts'

function feature(
  kind: SegmentFeature['kind'],
  value: number,
  overrides: Partial<SegmentFeature> = {},
): SegmentFeature {
  return {
    segmentId: 'seg',
    kind,
    value,
    source: 'municipal_open_data',
    observedAt: NIGHT.toISOString(),
    expiresAt: null,
    confidence: 0.9,
    ...overrides,
  }
}

describe('scoreSegment', () => {
  it('scores a fully covered segment as the weighted mean of its signals', () => {
    const score = scoreSegment(
      'seg',
      [
        feature('human_activity', 1),
        feature('lighting', 1),
        feature('street_context', 1),
        feature('open_places', 1),
        feature('transit_presence', 1),
        feature('live_reports', 1),
        feature('historical_context', 1),
      ],
      NIGHT,
    )
    expect(score.score).toBeCloseTo(100, 1)
    expect(score.coverage).toBeCloseTo(1, 6)
  })

  it('missing data lowers coverage and confidence but not the score', () => {
    // Spec section Het: "no data != dangerous; in that case confidence drops."
    const full = scoreSegment(
      'seg',
      [feature('human_activity', 0.8), feature('lighting', 0.8), feature('street_context', 0.8)],
      NIGHT,
    )
    const partial = scoreSegment('seg', [feature('human_activity', 0.8)], NIGHT)

    expect(partial.score).toBeCloseTo(full.score, 5)
    expect(partial.coverage).toBeLessThan(full.coverage)
    expect(partial.confidence).toBeLessThan(full.confidence)
  })

  it('an unknown signal is never treated as a zero', () => {
    const withUnknownLighting = scoreSegment('seg', [feature('human_activity', 0.9)], NIGHT)
    const withDarkLighting = scoreSegment(
      'seg',
      [feature('human_activity', 0.9), feature('lighting', 0)],
      NIGHT,
    )
    expect(withUnknownLighting.score).toBeGreaterThan(withDarkLighting.score)
  })

  it('returns a neutral score with zero confidence when nothing is known', () => {
    const score = scoreSegment('seg', [], NIGHT)
    expect(score.score).toBe(50)
    expect(score.confidence).toBe(0)
    expect(score.coverage).toBe(0)
  })

  it('keeps only the highest-confidence observation per signal kind', () => {
    const score = scoreSegment(
      'seg',
      [
        feature('lighting', 0.1, { confidence: 0.3, source: 'safe_reports' }),
        feature('lighting', 0.9, { confidence: 0.95 }),
      ],
      NIGHT,
    )
    expect(score.contributions).toHaveLength(1)
    expect(score.contributions[0]!.value).toBe(0.9)
  })

  it('reports contributions ordered by how much they moved the score', () => {
    const score = scoreSegment(
      'seg',
      [feature('historical_context', 1), feature('human_activity', 1)],
      NIGHT,
    )
    expect(score.contributions[0]!.kind).toBe('human_activity')
  })

  it('discards a feature that has already expired', () => {
    const expired = feature('live_reports', 0.1, {
      observedAt: new Date(NIGHT.getTime() - 120 * 60_000).toISOString(),
      expiresAt: new Date(NIGHT.getTime() - 60 * 60_000).toISOString(),
    })
    // scoreSegment does not filter by expiry itself - the store does - but an
    // expired feature must at least contribute no confidence.
    const score = scoreSegment('seg', [expired], NIGHT)
    expect(score.confidence).toBe(0)
  })
})
