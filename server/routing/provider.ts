/**
 * Routing provider seam.
 *
 * Spec section Zayin leaves the provider choice open (Mapbox Directions for a
 * fast MVP, GraphHopper with custom models for a SAFE-specific engine, or a
 * hybrid). Everything above this interface - the Safety Engine, the decision
 * policy, the explanation layer - is written against `RoutingProvider` alone,
 * so that decision stays reversible.
 */

import type { LatLng, Route } from '../../shared/types.ts'
import { findAlternatives } from './graphRouter.ts'

export interface RoutingProvider {
  readonly name: string
  /** Geographic alternatives only. No safety weighting happens here. */
  alternatives(origin: LatLng, destination: LatLng): Promise<Route[]>
}

export const graphProvider: RoutingProvider = {
  name: 'builtin-graph',
  async alternatives(origin, destination) {
    return findAlternatives(origin, destination)
  },
}

export function getRoutingProvider(): RoutingProvider {
  const configured = process.env.ROUTING_PROVIDER ?? 'graph'
  if (configured === 'graph') return graphProvider
  // Deliberately loud: a half-wired provider must not silently degrade into
  // the mock graph in something that ships.
  throw new Error(
    `ROUTING_PROVIDER="${configured}" is not implemented in Phase 0. ` +
      `Implement RoutingProvider and register it here.`,
  )
}
