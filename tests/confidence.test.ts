import { describe, expect, it } from 'vitest'
import type { SegmentFeature } from '../shared/types.ts'
import {
  confidenceBand,
  corroborationBonus,
  featureConfidence,
  freshnessFactor,
  segmentConfidence,
} from '../server/safety/confidence.ts'
import { NIGHT } from './helpers.ts'

function reportFeature(ageMinutes: number, ttlMinutes = 90): SegmentFeature {
  const observed = new Date(NIGHT.getTime() - ageMinutes * 60_000)
  return {
    segmentId: 'seg',
    kind: 'live_reports',
    value: 0.3,
    source: 'safe_reports',
    observedAt: observed.toISOString(),
    expiresAt: new Date(observed.getTime() + ttlMinutes * 60_000).toISOString(),
    confidence: 0.6,
  }
}

describe('freshness', () => {
  it('a five-minute-old report outweighs a ninety-minute-old one', () => {
    // Spec section Yod-Gimel names exactly this comparison.
    expect(freshnessFactor(reportFeature(5), NIGHT)).toBeGreaterThan(
      freshnessFactor(reportFeature(89), NIGHT),
    )
  })

  it('drops to zero once a feature is past its TTL', () => {
    expect(freshnessFactor(reportFeature(120, 90), NIGHT)).toBe(0)
  })

  it('does not decay a feature with no expiry', () => {
    const staticFeature: SegmentFeature = { ...reportFeature(600), expiresAt: null, source: 'osm' }
    expect(freshnessFactor(staticFeature, NIGHT)).toBe(1)
  })
})

describe('corroboration', () => {
  it('raises confidence when several signals agree', () => {
    expect(corroborationBonus({ ...reportFeature(5), corroboration: 4 })).toBeGreaterThan(
      corroborationBonus({ ...reportFeature(5), corroboration: 1 }),
    )
  })

  it('is capped, so a report brigade cannot manufacture certainty', () => {
    expect(corroborationBonus({ ...reportFeature(5), corroboration: 5000 })).toBeLessThanOrEqual(1.35)
  })
})

describe('source quality', () => {
  it('trusts official open data above a single anonymous report', () => {
    const official: SegmentFeature = {
      ...reportFeature(5),
      source: 'municipal_open_data',
      expiresAt: null,
    }
    const anonymous: SegmentFeature = { ...reportFeature(5), source: 'safe_reports', expiresAt: null }
    expect(featureConfidence(official, NIGHT)).toBeGreaterThan(
      featureConfidence(anonymous, NIGHT),
    )
  })

  it('discounts the coarse historical layer for its low spatial precision', () => {
    const historical: SegmentFeature = {
      ...reportFeature(0),
      kind: 'historical_context',
      source: 'police_historical',
      expiresAt: null,
    }
    const local: SegmentFeature = { ...reportFeature(0), source: 'municipal_open_data', expiresAt: null }
    expect(featureConfidence(historical, NIGHT)).toBeLessThan(featureConfidence(local, NIGHT))
  })
})

describe('segmentConfidence', () => {
  it('rises with coverage', () => {
    const f = { feature: reportFeature(5), weight: 0.2 }
    expect(segmentConfidence([f], 0.9, NIGHT)).toBeGreaterThan(
      segmentConfidence([f], 0.3, NIGHT),
    )
  })

  it('weights each signal by its model weight, not equally', () => {
    const good = { ...reportFeature(1), source: 'municipal_open_data' as const, expiresAt: null }
    const weak = { ...reportFeature(85) }

    const goodSignalDominant = segmentConfidence(
      [{ feature: good, weight: 0.8 }, { feature: weak, weight: 0.2 }],
      1,
      NIGHT,
    )
    const weakSignalDominant = segmentConfidence(
      [{ feature: good, weight: 0.2 }, { feature: weak, weight: 0.8 }],
      1,
      NIGHT,
    )
    expect(goodSignalDominant).toBeGreaterThan(weakSignalDominant)
  })

  it('is zero when there is nothing to be confident about', () => {
    expect(segmentConfidence([], 0, NIGHT)).toBe(0)
  })
})

describe('confidenceBand', () => {
  it('maps to the three bands in spec section Yod-Gimel', () => {
    expect(confidenceBand(0.85)).toBe('high')
    expect(confidenceBand(0.55)).toBe('medium')
    expect(confidenceBand(0.2)).toBe('low')
  })
})
