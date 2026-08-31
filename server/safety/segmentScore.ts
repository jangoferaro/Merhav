/**
 * Segment scoring - the base unit of the SAFE Score (spec section Het).
 *
 * The rule that shapes this file: "no data != dangerous; in that case
 * confidence goes down". Concretely, weights are renormalised over the signals
 * that are actually present, so an unknown signal has no opinion about the
 * score at all. It shows up in `coverage`, which feeds confidence instead.
 */

import type { SegmentFeature, SegmentScore, SignalContribution } from '../../shared/types.ts'
import { segmentConfidence } from './confidence.ts'
import { MODEL_VERSION, weightsFor } from './weights.ts'

export function scoreSegment(
  segmentId: string,
  features: SegmentFeature[],
  at: Date,
): SegmentScore {
  const weights = weightsFor(at)

  // Keep one feature per signal kind - the highest-confidence observation wins.
  const best = new Map<string, SegmentFeature>()
  for (const f of features) {
    const current = best.get(f.kind)
    if (!current || f.confidence > current.confidence) best.set(f.kind, f)
  }
  const present = [...best.values()]

  const coverage = present.reduce((sum, f) => sum + weights[f.kind], 0)
  if (present.length === 0 || coverage === 0) {
    // Nothing known. Deliberately a neutral 50, not a 0 - see the header note.
    return {
      segmentId,
      score: 50,
      confidence: 0,
      coverage: 0,
      contributions: [],
      modelVersion: MODEL_VERSION,
    }
  }

  const contributions: SignalContribution[] = []
  let weighted = 0
  for (const f of present) {
    const normalised = weights[f.kind] / coverage
    const effect = f.value * normalised
    weighted += effect
    contributions.push({
      kind: f.kind,
      value: f.value,
      weight: weights[f.kind],
      effect,
      source: f.source,
      ageMinutes: Math.max(
        0,
        Math.round((at.getTime() - new Date(f.observedAt).getTime()) / 60_000),
      ),
    })
  }

  return {
    segmentId,
    score: Math.round(weighted * 1000) / 10,
    confidence: segmentConfidence(
      present.map((f) => ({ feature: f, weight: weights[f.kind] })),
      coverage,
      at,
    ),
    coverage,
    contributions: contributions.sort((a, b) => b.effect - a.effect),
    modelVersion: MODEL_VERSION,
  }
}
