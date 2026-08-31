/**
 * Route-level aggregation (spec section Het).
 *
 *   Route Safety = 0.65 * length-weighted mean + 0.35 * worst meaningful segment
 *
 * The spec spells out why the second term exists: "a route with 95% good
 * segments and one problematic segment must not hide it inside a high
 * average." A plain mean is the thing this formula is defined against, so the
 * worst-segment term is not an optional refinement.
 */

import type { Route, SegmentScore } from '../../shared/types.ts'
import { getSegment } from '../routing/graph.ts'
import {
  MEANINGFUL_SEGMENT_MIN_M,
  MEANINGFUL_SEGMENT_SHARE,
  ROUTE_MEAN_WEIGHT,
  ROUTE_WORST_WEIGHT,
} from './weights.ts'

export interface RouteAggregate {
  safetyScore: number
  confidence: number
  coverage: number
  weakestSegment: { segmentId: string; name: string; score: number } | null
}

/**
 * A segment is "meaningful" when it is long enough to matter. Without this,
 * a six-metre connector could drag a whole route down through the worst-
 * segment term.
 */
export function isMeaningfulSegment(lengthM: number, routeLengthM: number): boolean {
  return (
    lengthM >= MEANINGFUL_SEGMENT_MIN_M ||
    (routeLengthM > 0 && lengthM / routeLengthM >= MEANINGFUL_SEGMENT_SHARE)
  )
}

export function aggregateRoute(route: Route, scores: SegmentScore[]): RouteAggregate {
  if (scores.length === 0) {
    return { safetyScore: 50, confidence: 0, coverage: 0, weakestSegment: null }
  }

  const byId = new Map(scores.map((s) => [s.segmentId, s]))
  const lengths = route.segmentIds.map((id) => getSegment(id).lengthM)
  const totalLength = lengths.reduce((a, b) => a + b, 0)

  let weightedScore = 0
  let weightedConfidence = 0
  let weightedCoverage = 0
  let weakest: { segmentId: string; name: string; score: number } | null = null

  // A plain loop rather than forEach: assigning `weakest` from inside a
  // callback defeats TypeScript's narrowing, and the null check below then
  // reads as unreachable.
  for (let index = 0; index < route.segmentIds.length; index++) {
    const id = route.segmentIds[index]!
    const score = byId.get(id)
    const lengthM = lengths[index] ?? 0
    if (!score || totalLength === 0) continue
    const share = lengthM / totalLength
    weightedScore += score.score * share
    weightedConfidence += score.confidence * share
    weightedCoverage += score.coverage * share

    if (isMeaningfulSegment(lengthM, totalLength)) {
      if (weakest === null || score.score < weakest.score) {
        weakest = { segmentId: id, name: getSegment(id).name, score: score.score }
      }
    }
  }

  // If nothing cleared the "meaningful" bar (a very short route), fall back to
  // the mean rather than inventing a weak point.
  const worstScore = weakest === null ? weightedScore : weakest.score

  const safetyScore =
    ROUTE_MEAN_WEIGHT * weightedScore + ROUTE_WORST_WEIGHT * worstScore

  return {
    safetyScore: Math.round(safetyScore * 10) / 10,
    confidence: Math.round(weightedConfidence * 1000) / 1000,
    coverage: Math.round(weightedCoverage * 1000) / 1000,
    weakestSegment: weakest,
  }
}
