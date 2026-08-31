/**
 * Confidence, kept strictly separate from the SAFE Score.
 *
 * Spec section Yod-Gimel is unambiguous: "a route may get a good score but low
 * confidence because of a lack of fresh data; in that case the recommendation
 * should be less emphatic." Merging the two would quietly turn "we don't know"
 * into "it's fine", which is the failure mode the whole section exists to
 * prevent.
 */

import type { ConfidenceBand, SegmentFeature, SourceId } from '../../shared/types.ts'
import { CONFIDENCE_HIGH, CONFIDENCE_MEDIUM } from './weights.ts'

/**
 * Typical reliability by source, spec section Yod-Gimel: official Open Data
 * first, then several independent users, then a single anonymous report.
 * An official source still is not "truth" - it just scores higher.
 */
export const SOURCE_RELIABILITY: Record<SourceId, number> = {
  municipal_open_data: 0.9,
  gtfs: 0.88,
  osm: 0.82,
  police_historical: 0.75,
  poi_provider: 0.7,
  safe_telemetry: 0.65,
  safe_reports: 0.45,
  mock: 0.4,
}

/**
 * Spatial precision. A specific segment is more precise than a broad
 * statistical area, so the coarse historical layer is discounted.
 */
export const SPATIAL_PRECISION: Record<SourceId, number> = {
  municipal_open_data: 0.9,
  gtfs: 0.85,
  osm: 1.0,
  police_historical: 0.4,
  poi_provider: 0.85,
  safe_telemetry: 0.8,
  safe_reports: 0.75,
  mock: 0.6,
}

/**
 * Freshness decay. A five-minute-old report and a ninety-minute-old report do
 * not carry the same weight (spec section Yod-Gimel). Features with no expiry
 * are static facts and do not decay.
 */
export function freshnessFactor(feature: SegmentFeature, at: Date): number {
  if (feature.expiresAt === null) return 1
  const observed = new Date(feature.observedAt).getTime()
  const expires = new Date(feature.expiresAt).getTime()
  const ttl = expires - observed
  if (ttl <= 0) return 0
  const age = at.getTime() - observed
  if (age <= 0) return 1
  if (age >= ttl) return 0
  // Decays to ~0.37 of its starting weight at the end of its TTL, then to 0.
  return Math.exp(-age / ttl) * (1 - age / ttl) + (1 - age / ttl) * 0.3
}

/** Corroboration: several independent signals pointing the same way raise confidence. */
export function corroborationBonus(feature: SegmentFeature): number {
  const n = feature.corroboration ?? 1
  if (n <= 1) return 1
  return Math.min(1.35, 1 + Math.log2(n) * 0.12)
}

/**
 * Source quality, combining reliability and spatial precision into ONE factor.
 *
 * These are two views of the same question - how much this source can be
 * trusted about this specific street - so multiplying them would double-count
 * the discount and drag every observation toward zero.
 */
export function sourceQuality(source: SourceId): number {
  return (SOURCE_RELIABILITY[source] + SPATIAL_PRECISION[source]) / 2
}

/** Confidence in a single observation, 0..1. */
export function featureConfidence(feature: SegmentFeature, at: Date): number {
  const value =
    feature.confidence *
    sourceQuality(feature.source) *
    freshnessFactor(feature, at) *
    corroborationBonus(feature)
  return Math.max(0, Math.min(1, value))
}

/**
 * Segment confidence combines how much of the weight budget is covered by
 * present signals with how good those signals are.
 *
 * The mean is weighted by each signal's model weight, not flat: confidence in
 * a score should track the signals that actually drive that score, so a shaky
 * reading on a 28%-weight signal must count for more than a shaky reading on a
 * 6%-weight one.
 *
 * Weights are passed in rather than looked up, because only the scorer knows
 * which profile (day or night) was in force.
 */
export function segmentConfidence(
  weighted: { feature: SegmentFeature; weight: number }[],
  coverage: number,
  at: Date,
): number {
  if (weighted.length === 0) return 0
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0)
  if (totalWeight === 0) return 0
  const mean =
    weighted.reduce((sum, w) => sum + w.weight * featureConfidence(w.feature, at), 0) /
    totalWeight
  // Coverage enters with a square root so that a segment with two excellent
  // signals is not written off entirely, but still ranks below a fully
  // covered one.
  return Math.max(0, Math.min(1, mean * Math.sqrt(Math.max(0, Math.min(1, coverage)))))
}

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= CONFIDENCE_HIGH) return 'high'
  if (confidence >= CONFIDENCE_MEDIUM) return 'medium'
  return 'low'
}
