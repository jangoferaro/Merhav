/** Request validation. Kept separate so every endpoint rejects the same way. */

import type { LatLng, SafetyPreferences } from '../../shared/types.ts'
import { DEFAULT_PREFERENCES } from '../../shared/types.ts'

export class BadRequest extends Error {
  readonly status = 400
  constructor(message: string) {
    super(message)
    this.name = 'BadRequest'
  }
}

/** Rough bounding box for Tel Aviv-Yafo; Phase 0 serves one city. */
const BOUNDS = { minLat: 31.95, maxLat: 32.2, minLng: 34.6, maxLng: 34.9 }

export function parseLatLng(value: unknown, field: string): LatLng {
  if (typeof value !== 'object' || value === null) {
    throw new BadRequest(`${field} must be an object with lat and lng`)
  }
  const { lat, lng } = value as Record<string, unknown>
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new BadRequest(`${field}.lat and ${field}.lng must be finite numbers`)
  }
  if (lat < BOUNDS.minLat || lat > BOUNDS.maxLat || lng < BOUNDS.minLng || lng > BOUNDS.maxLng) {
    throw new BadRequest(`${field} is outside the Tel Aviv-Yafo coverage area`)
  }
  return { lat, lng }
}

export function parseTimestamp(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new BadRequest(`${field} must be an ISO timestamp string`)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new BadRequest(`${field} is not a valid ISO timestamp`)
  return date
}

const LEVELS = ['low', 'normal', 'high'] as const

export function parsePreferences(value: unknown): SafetyPreferences {
  if (value === undefined || value === null) return DEFAULT_PREFERENCES
  if (typeof value !== 'object') throw new BadRequest('preferences must be an object')
  const raw = value as Record<string, unknown>

  const detour = raw.maxDetourMinutes ?? DEFAULT_PREFERENCES.maxDetourMinutes
  if (detour !== 'auto' && detour !== 3 && detour !== 5 && detour !== 10) {
    throw new BadRequest('preferences.maxDetourMinutes must be 3, 5, 10 or "auto"')
  }

  const level = (key: keyof SafetyPreferences, fallback: (typeof LEVELS)[number]) => {
    const v = raw[key] ?? fallback
    if (!LEVELS.includes(v as (typeof LEVELS)[number])) {
      throw new BadRequest(`preferences.${key} must be one of ${LEVELS.join(', ')}`)
    }
    return v as (typeof LEVELS)[number]
  }

  const avoidParks = raw.avoidParksAtNight ?? DEFAULT_PREFERENCES.avoidParksAtNight
  if (typeof avoidParks !== 'boolean') {
    throw new BadRequest('preferences.avoidParksAtNight must be a boolean')
  }

  return {
    maxDetourMinutes: detour,
    preferMainStreets: level('preferMainStreets', DEFAULT_PREFERENCES.preferMainStreets),
    avoidParksAtNight: avoidParks,
    preferOpenPlaces: level('preferOpenPlaces', DEFAULT_PREFERENCES.preferOpenPlaces),
    preferLitRoutes: level('preferLitRoutes', DEFAULT_PREFERENCES.preferLitRoutes),
  }
}
