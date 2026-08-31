import { getNode } from '../server/routing/graph.ts'

/** The scenario in spec section Kaf-Gimel: 01:42 in Florentin. */
export const FLORENTIN = getNode('flo_herzl').position
export const CITY_CENTRE = getNode('allenby_nahalat').position

export function at(iso: string): Date {
  return new Date(iso)
}

export const NIGHT = at('2026-08-31T01:42:00+03:00')
export const AFTERNOON = at('2026-08-31T14:00:00+03:00')
