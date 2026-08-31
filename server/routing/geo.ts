/**
 * Small geodesy helpers. Kept dependency-free so the routing layer can be
 * swapped for a provider SDK without dragging a geo library along.
 */

import type { LatLng } from '../../shared/types.ts'

const EARTH_RADIUS_M = 6_371_000

const toRad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

export function pathLengthM(points: LatLng[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += haversineM(points[i - 1]!, points[i]!)
  }
  return total
}

/**
 * Average pedestrian pace. 1.34 m/s is the usual figure for adults on level
 * urban pavement; it is the only speed assumption in the prototype, so ETA
 * calibration has exactly one place to change.
 */
export const WALKING_SPEED_MPS = 1.34

export function durationS(distanceM: number): number {
  return Math.round(distanceM / WALKING_SPEED_MPS)
}

interface Projection {
  /** Distance from the point to the segment, in metres. */
  distanceM: number
  /** Where the projection falls along the segment, 0 at `a` and 1 at `b`. */
  t: number
}

/**
 * Project `p` onto the segment `a`-`b`.
 *
 * A local equirectangular projection, which is accurate to well under a metre
 * over city blocks and avoids pulling in a geodesy library.
 */
function projectOntoSegment(p: LatLng, a: LatLng, b: LatLng): Projection {
  const latRef = toRad((a.lat + b.lat) / 2)
  const x = (pt: LatLng) => toRad(pt.lng) * Math.cos(latRef) * EARTH_RADIUS_M
  const y = (pt: LatLng) => toRad(pt.lat) * EARTH_RADIUS_M

  const ax = x(a)
  const ay = y(a)
  const dx = x(b) - ax
  const dy = y(b) - ay
  const px = x(p)
  const py = y(p)

  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return { distanceM: Math.hypot(px - ax, py - ay), t: 0 }

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return { distanceM: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t }
}

/** Shortest distance in metres from `p` to the segment `a`-`b`. */
export function distanceToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  return projectOntoSegment(p, a, b).distanceM
}

/** Shortest distance in metres from `p` to a polyline. */
export function distanceToPathM(p: LatLng, path: LatLng[]): number {
  if (path.length === 0) return Infinity
  if (path.length === 1) return haversineM(p, path[0]!)
  let best = Infinity
  for (let i = 1; i < path.length; i++) {
    best = Math.min(best, distanceToSegmentM(p, path[i - 1]!, path[i]!))
  }
  return best
}

/**
 * How far along `path` the projection of `p` falls, in metres.
 *
 * Uses the projection parameter of the nearest leg, so a position part-way
 * down a street reports part-way progress. Feeds the progress bar, the
 * remaining distance and the live ETA.
 */
export function progressAlongPathM(p: LatLng, path: LatLng[]): number {
  if (path.length < 2) return 0

  let travelled = 0
  let bestDistance = Infinity
  let bestProgress = 0

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!
    const b = path[i]!
    const legLength = haversineM(a, b)
    const { distanceM, t } = projectOntoSegment(p, a, b)
    if (distanceM < bestDistance) {
      bestDistance = distanceM
      bestProgress = travelled + t * legLength
    }
    travelled += legLength
  }

  return bestProgress
}
