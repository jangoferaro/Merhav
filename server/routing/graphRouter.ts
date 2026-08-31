/**
 * Alternative-route generation over the built-in graph.
 *
 * The spec asks the routing layer for two to three plausible walking
 * alternatives (section Heh, step 3) and is explicit that this stage is
 * geographic only - SAFE scoring happens afterwards, in the Safety Engine.
 * So nothing in this file knows about safety signals.
 *
 * Method: shortest path, then repeated shortest paths with the already-used
 * segments penalised, which yields genuinely different corridors rather than
 * near-identical variants of one path (the usual failure of naive k-shortest).
 */

import type { LatLng, Route } from '../../shared/types.ts'
import { ADJACENCY, getNode, getSegment, nearestNode } from './graph.ts'
import { durationS } from './geo.ts'

interface PathResult {
  nodeIds: string[]
  segmentIds: string[]
  distanceM: number
}

/** Dijkstra with a per-segment multiplier, used to push later runs off the first path. */
function shortestPath(
  startNode: string,
  goalNode: string,
  penalty: Map<string, number>,
): PathResult | null {
  const dist = new Map<string, number>([[startNode, 0]])
  const prev = new Map<string, { node: string; segmentId: string }>()
  const visited = new Set<string>()

  while (true) {
    let current: string | null = null
    let currentDist = Infinity
    for (const [node, d] of dist) {
      if (!visited.has(node) && d < currentDist) {
        current = node
        currentDist = d
      }
    }
    if (current === null) return null
    if (current === goalNode) break
    visited.add(current)

    for (const edge of ADJACENCY.get(current) ?? []) {
      if (visited.has(edge.toNode)) continue
      const seg = getSegment(edge.segmentId)
      const cost = seg.lengthM * (penalty.get(edge.segmentId) ?? 1)
      const next = currentDist + cost
      if (next < (dist.get(edge.toNode) ?? Infinity)) {
        dist.set(edge.toNode, next)
        prev.set(edge.toNode, { node: current, segmentId: edge.segmentId })
      }
    }
  }

  const nodeIds: string[] = [goalNode]
  const segmentIds: string[] = []
  let cursor = goalNode
  while (cursor !== startNode) {
    const step = prev.get(cursor)
    if (!step) return null
    segmentIds.unshift(step.segmentId)
    nodeIds.unshift(step.node)
    cursor = step.node
  }

  // Re-measure on true lengths: `dist` carries the penalties, which are a
  // search device and must never leak into the reported distance or ETA.
  const distanceM = segmentIds.reduce((sum, id) => sum + getSegment(id).lengthM, 0)
  return { nodeIds, segmentIds, distanceM }
}

function toRoute(index: number, path: PathResult): Route {
  const geometry: LatLng[] = path.nodeIds.map((id) => getNode(id).position)
  return {
    id: `r${index + 1}`,
    segmentIds: path.segmentIds,
    geometry,
    distanceM: Math.round(path.distanceM),
    durationS: durationS(path.distanceM),
  }
}

/** Fraction of `candidate`'s length already covered by `existing`. */
function overlapRatio(candidate: PathResult, existing: PathResult[]): number {
  const used = new Set(existing.flatMap((p) => p.segmentIds))
  const shared = candidate.segmentIds
    .filter((id) => used.has(id))
    .reduce((sum, id) => sum + getSegment(id).lengthM, 0)
  return candidate.distanceM === 0 ? 1 : shared / candidate.distanceM
}

export interface AlternativesOptions {
  /** Spec section Heh asks for two to three alternatives. */
  maxRoutes?: number
  /** Reject a candidate that mostly retraces an accepted one. */
  maxOverlap?: number
  /** Reject a candidate far longer than the shortest path. */
  maxLengthRatio?: number
}

export function findAlternatives(
  origin: LatLng,
  destination: LatLng,
  options: AlternativesOptions = {},
): Route[] {
  const { maxRoutes = 3, maxOverlap = 0.7, maxLengthRatio = 1.9 } = options

  const start = nearestNode(origin)
  const goal = nearestNode(destination)
  if (start.id === goal.id) return []

  const penalty = new Map<string, number>()
  const accepted: PathResult[] = []

  // A few extra attempts, since candidates can be rejected for overlap.
  for (let attempt = 0; attempt < maxRoutes + 4 && accepted.length < maxRoutes; attempt++) {
    const path = shortestPath(start.id, goal.id, penalty)
    if (!path) break

    const shortest = accepted[0]
    const acceptable =
      accepted.length === 0 ||
      (overlapRatio(path, accepted) <= maxOverlap &&
        path.distanceM <= shortest!.distanceM * maxLengthRatio)

    if (acceptable) accepted.push(path)

    // Penalise what this attempt used so the next search looks elsewhere.
    for (const id of path.segmentIds) {
      penalty.set(id, (penalty.get(id) ?? 1) * 2.2)
    }
  }

  return accepted
    .sort((a, b) => a.distanceM - b.distanceM)
    .map((path, index) => toRoute(index, path))
}
