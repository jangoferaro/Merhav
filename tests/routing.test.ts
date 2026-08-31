import { describe, expect, it } from 'vitest'
import { findAlternatives } from '../server/routing/graphRouter.ts'
import { ADJACENCY, NODES, SEGMENTS, getNode, nearestNode } from '../server/routing/graph.ts'
import {
  distanceToPathM,
  haversineM,
  pathLengthM,
  progressAlongPathM,
} from '../server/routing/geo.ts'
import { CITY_CENTRE, FLORENTIN } from './helpers.ts'

describe('graph integrity', () => {
  it('every segment connects two known nodes', () => {
    const ids = new Set(NODES.map((n) => n.id))
    for (const segment of SEGMENTS.values()) {
      expect(ids.has(segment.from), segment.id).toBe(true)
      expect(ids.has(segment.to), segment.id).toBe(true)
    }
  })

  it('is fully connected, so every node can be reached from every other', () => {
    const seen = new Set<string>([NODES[0]!.id])
    const queue = [NODES[0]!.id]
    while (queue.length > 0) {
      for (const edge of ADJACENCY.get(queue.pop()!) ?? []) {
        if (!seen.has(edge.toNode)) {
          seen.add(edge.toNode)
          queue.push(edge.toNode)
        }
      }
    }
    expect(seen.size).toBe(NODES.length)
  })

  it('derives every segment length from its geometry', () => {
    for (const segment of SEGMENTS.values()) {
      expect(segment.lengthM).toBeCloseTo(pathLengthM(segment.geometry), 6)
      expect(segment.lengthM, segment.id).toBeGreaterThan(0)
    }
  })
})

describe('nearestNode', () => {
  it('snaps an arbitrary coordinate to the closest junction', () => {
    const target = getNode('carmel')
    const nudged = { lat: target.position.lat + 0.0002, lng: target.position.lng - 0.0001 }
    expect(nearestNode(nudged).id).toBe('carmel')
  })
})

describe('findAlternatives', () => {
  const routes = findAlternatives(FLORENTIN, CITY_CENTRE)

  it('returns the two to three alternatives the spec asks for', () => {
    expect(routes.length).toBeGreaterThanOrEqual(2)
    expect(routes.length).toBeLessThanOrEqual(3)
  })

  it('orders them shortest first', () => {
    const durations = routes.map((r) => r.durationS)
    expect([...durations].sort((a, b) => a - b)).toEqual(durations)
  })

  it('produces genuinely different corridors, not variants of one path', () => {
    // The failure mode of naive k-shortest-path: three routes that share 95%
    // of their length and differ by one block.
    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        const a = new Set(routes[i]!.segmentIds)
        const shared = routes[j]!.segmentIds.filter((id) => a.has(id))
        const overlap =
          shared.reduce((s, id) => s + SEGMENTS.get(id)!.lengthM, 0) / routes[j]!.distanceM
        expect(overlap, `${routes[i]!.id} vs ${routes[j]!.id}`).toBeLessThanOrEqual(0.7)
      }
    }
  })

  it('reports distances that match the geometry it returned', () => {
    // The router penalises segments internally to find alternatives; those
    // penalties must never leak into the reported distance or ETA.
    for (const route of routes) {
      const fromSegments = route.segmentIds.reduce(
        (s, id) => s + SEGMENTS.get(id)!.lengthM,
        0,
      )
      expect(route.distanceM).toBeCloseTo(Math.round(fromSegments), 0)
      expect(route.durationS).toBe(Math.round(fromSegments / 1.34))
    }
  })

  it('every route actually starts at A and ends at B', () => {
    for (const route of routes) {
      expect(haversineM(route.geometry[0]!, FLORENTIN)).toBeLessThan(1)
      expect(haversineM(route.geometry.at(-1)!, CITY_CENTRE)).toBeLessThan(1)
    }
  })

  it('returns nothing when origin and destination snap to the same junction', () => {
    expect(findAlternatives(FLORENTIN, FLORENTIN)).toEqual([])
  })
})

describe('distanceToPathM', () => {
  it('is zero on the path and grows with deviation', () => {
    const path = findAlternatives(FLORENTIN, CITY_CENTRE)[0]!.geometry
    expect(distanceToPathM(path[1]!, path)).toBeLessThan(1)
    const off = { lat: path[1]!.lat + 0.003, lng: path[1]!.lng + 0.003 }
    expect(distanceToPathM(off, path)).toBeGreaterThan(100)
  })
})

describe('progressAlongPathM', () => {
  const path = [
    { lat: 32.0562, lng: 34.7688 },
    { lat: 32.0584, lng: 34.7684 },
    { lat: 32.0608, lng: 34.7678 },
  ]
  const legOne = haversineM(path[0]!, path[1]!)

  it('is zero at the start and the full length at the end', () => {
    expect(progressAlongPathM(path[0]!, path)).toBeCloseTo(0, 1)
    expect(progressAlongPathM(path[2]!, path)).toBeCloseTo(pathLengthM(path), 1)
  })

  it('reports part-way progress part-way down a leg, not just at vertices', () => {
    // The naive version snapped to leg starts, so the progress bar only ever
    // moved when a vertex was reached.
    const midpoint = {
      lat: (path[0]!.lat + path[1]!.lat) / 2,
      lng: (path[0]!.lng + path[1]!.lng) / 2,
    }
    expect(progressAlongPathM(midpoint, path)).toBeCloseTo(legOne / 2, 0)
  })

  it('increases monotonically along the route', () => {
    let previous = -1
    for (let i = 0; i <= 10; i++) {
      const t = i / 10
      const point = {
        lat: path[0]!.lat + (path[1]!.lat - path[0]!.lat) * t,
        lng: path[0]!.lng + (path[1]!.lng - path[0]!.lng) * t,
      }
      const progress = progressAlongPathM(point, path)
      expect(progress).toBeGreaterThan(previous)
      previous = progress
    }
  })
})
