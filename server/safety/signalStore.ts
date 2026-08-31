/**
 * Feature store for segment signals.
 *
 * Spec section Tet describes a Data Layer that unifies sources with different
 * refresh rates and resolutions, where "every signal is stored with source,
 * timestamp, geography, confidence and expiration". Phase 0 implements that
 * shape against seeded profiles instead of live feeds, so the Safety Engine
 * above it is exercised for real and the feeds can be swapped in one by one.
 *
 * Two rules from the spec are load-bearing here and are easy to lose:
 *   1. A signal that is absent is ABSENT, not zero. Returning 0 for "unknown
 *      lighting" would mean "no data = dangerous", which section Het forbids.
 *      Unknown signals are simply not emitted, and coverage/confidence drop.
 *   2. Nothing in a profile describes people. Only streets, lights, opening
 *      hours, transit service and reports.
 */

import type {
  LiveReport,
  SegmentFeature,
  SignalKind,
  SourceId,
} from '../../shared/types.ts'
import { SEGMENTS, getSegment } from '../routing/graph.ts'
import { STREET_CONTEXT_VALUE } from './weights.ts'
import { cityClock } from './cityTime.ts'

/* ------------------------------------------------------------------ *
 * Hour curves
 * ------------------------------------------------------------------ */

export type ActivityProfile =
  | 'nightlife'
  | 'commercial'
  | 'residential'
  | 'quiet'
  | 'traffic_artery'

/**
 * Pedestrian presence by hour, 0..1. Aggregate only - a count of how busy a
 * street tends to be, never who is on it (spec section Het, human activity is
 * "aggregate and non-identifying").
 */
const ACTIVITY_CURVES: Record<ActivityProfile, number[]> = {
  //          00   01   02   03   04   05   06   07   08   09   10   11
  //          12   13   14   15   16   17   18   19   20   21   22   23
  nightlife: [
    0.82, 0.78, 0.62, 0.38, 0.22, 0.18, 0.2, 0.3, 0.45, 0.52, 0.55, 0.58,
    0.62, 0.6, 0.58, 0.6, 0.65, 0.72, 0.8, 0.86, 0.9, 0.92, 0.9, 0.86,
  ],
  commercial: [
    0.22, 0.15, 0.1, 0.08, 0.07, 0.1, 0.2, 0.42, 0.65, 0.8, 0.88, 0.9,
    0.92, 0.9, 0.86, 0.85, 0.86, 0.88, 0.84, 0.7, 0.52, 0.4, 0.32, 0.26,
  ],
  residential: [
    0.14, 0.1, 0.08, 0.06, 0.06, 0.1, 0.22, 0.4, 0.5, 0.45, 0.42, 0.44,
    0.48, 0.46, 0.44, 0.48, 0.55, 0.62, 0.6, 0.52, 0.42, 0.34, 0.26, 0.18,
  ],
  quiet: [
    0.08, 0.06, 0.05, 0.04, 0.04, 0.06, 0.12, 0.22, 0.3, 0.3, 0.3, 0.32,
    0.34, 0.32, 0.3, 0.32, 0.36, 0.4, 0.38, 0.32, 0.24, 0.18, 0.14, 0.1,
  ],
  traffic_artery: [
    0.2, 0.16, 0.12, 0.1, 0.1, 0.16, 0.3, 0.45, 0.55, 0.55, 0.5, 0.5,
    0.52, 0.5, 0.5, 0.54, 0.6, 0.62, 0.58, 0.48, 0.4, 0.34, 0.28, 0.24,
  ],
}

/** Share of businesses along the segment that are open, by hour. */
const OPEN_PLACES_CURVES: Record<ActivityProfile, number[]> = {
  nightlife: [
    0.72, 0.68, 0.5, 0.22, 0.08, 0.05, 0.06, 0.14, 0.3, 0.4, 0.46, 0.5,
    0.55, 0.55, 0.52, 0.54, 0.58, 0.64, 0.72, 0.78, 0.82, 0.84, 0.82, 0.78,
  ],
  commercial: [
    0.06, 0.04, 0.03, 0.02, 0.02, 0.04, 0.1, 0.3, 0.6, 0.82, 0.9, 0.92,
    0.92, 0.88, 0.84, 0.86, 0.88, 0.88, 0.8, 0.6, 0.36, 0.22, 0.14, 0.1,
  ],
  residential: [
    0.05, 0.04, 0.03, 0.02, 0.02, 0.03, 0.08, 0.2, 0.34, 0.42, 0.46, 0.48,
    0.5, 0.48, 0.44, 0.46, 0.5, 0.52, 0.48, 0.38, 0.26, 0.18, 0.12, 0.08,
  ],
  quiet: [
    0.02, 0.02, 0.01, 0.01, 0.01, 0.02, 0.04, 0.1, 0.16, 0.2, 0.22, 0.24,
    0.26, 0.24, 0.22, 0.22, 0.24, 0.26, 0.24, 0.18, 0.12, 0.08, 0.05, 0.03,
  ],
  traffic_artery: [
    0.08, 0.06, 0.04, 0.03, 0.03, 0.05, 0.12, 0.28, 0.46, 0.58, 0.62, 0.64,
    0.66, 0.64, 0.6, 0.6, 0.62, 0.62, 0.56, 0.44, 0.3, 0.2, 0.14, 0.1,
  ],
}

/** Transit service level by hour, from GTFS-shaped schedule density. */
const TRANSIT_CURVE_FREQUENT = [
  0.35, 0.3, 0.15, 0.05, 0.05, 0.25, 0.6, 0.85, 0.95, 0.9, 0.85, 0.85,
  0.88, 0.86, 0.85, 0.88, 0.92, 0.95, 0.9, 0.8, 0.7, 0.6, 0.52, 0.44,
]
const TRANSIT_CURVE_SPARSE = [
  0.08, 0.05, 0.02, 0.0, 0.0, 0.05, 0.2, 0.4, 0.5, 0.45, 0.4, 0.4, 0.42,
  0.4, 0.4, 0.42, 0.48, 0.5, 0.45, 0.36, 0.28, 0.2, 0.15, 0.1,
]

function sampleCurve(curve: readonly number[], at: Date): number {
  // City-local hour: a segment's activity depends on the time in Tel Aviv,
  // not on the server's timezone.
  const { hour, minute } = cityClock(at)
  const next = (hour + 1) % 24
  const t = minute / 60
  const a = curve[hour] ?? 0
  const b = curve[next] ?? 0
  return a + (b - a) * t
}

/* ------------------------------------------------------------------ *
 * Segment profiles
 * ------------------------------------------------------------------ */

interface SegmentProfile {
  activity: ActivityProfile
  /** Omit entirely when the city has no lighting record for this segment. */
  lighting?: { value: number; source: SourceId; ageHours?: number }
  /** Omit when no POI/opening-hours licence covers this street. */
  openPlaces?: { profile: ActivityProfile; source: SourceId }
  transit?: { level: 'frequent' | 'sparse'; source: SourceId }
  /** Coarse statistical background only, deliberately low-resolution. */
  historical?: { value: number; source: SourceId }
}

/**
 * Seeded profiles keyed by street name, so a graph edit does not silently
 * orphan its data. Streets not listed fall back to their context defaults and
 * carry LESS data on purpose - the prototype needs sparse-data segments to
 * exercise the confidence path.
 */
const PROFILES_BY_STREET: Record<string, SegmentProfile> = {
  'רחוב הרצל': {
    activity: 'nightlife',
    lighting: { value: 0.82, source: 'municipal_open_data' },
    openPlaces: { profile: 'nightlife', source: 'poi_provider' },
    transit: { level: 'frequent', source: 'gtfs' },
    historical: { value: 0.6, source: 'police_historical' },
  },
  'שדרות אלנבי': {
    activity: 'nightlife',
    lighting: { value: 0.86, source: 'municipal_open_data' },
    openPlaces: { profile: 'nightlife', source: 'poi_provider' },
    transit: { level: 'frequent', source: 'gtfs' },
    historical: { value: 0.55, source: 'police_historical' },
  },
  'רחוב פלורנטין': {
    activity: 'nightlife',
    lighting: { value: 0.7, source: 'municipal_open_data' },
    openPlaces: { profile: 'nightlife', source: 'poi_provider' },
    historical: { value: 0.58, source: 'police_historical' },
  },
  'רחוב לוינסקי': {
    activity: 'commercial',
    lighting: { value: 0.68, source: 'municipal_open_data' },
    openPlaces: { profile: 'commercial', source: 'poi_provider' },
    transit: { level: 'frequent', source: 'gtfs' },
    historical: { value: 0.52, source: 'police_historical' },
  },
  'נחלת בנימין': {
    activity: 'residential',
    lighting: { value: 0.54, source: 'municipal_open_data' },
    openPlaces: { profile: 'residential', source: 'poi_provider' },
    historical: { value: 0.66, source: 'police_historical' },
  },
  'יהודה הלוי': {
    activity: 'traffic_artery',
    lighting: { value: 0.8, source: 'municipal_open_data' },
    openPlaces: { profile: 'traffic_artery', source: 'poi_provider' },
    transit: { level: 'frequent', source: 'gtfs' },
    historical: { value: 0.62, source: 'police_historical' },
  },
  'רחוב המלאכה': {
    activity: 'quiet',
    lighting: { value: 0.42, source: 'safe_reports', ageHours: 30 },
    historical: { value: 0.5, source: 'police_historical' },
    // No POI licence for this street: open_places is absent, not zero.
  },
  'רחוב ויטל': {
    activity: 'quiet',
    // No lighting record at all. Coverage drops, score is not punished.
    historical: { value: 0.48, source: 'police_historical' },
  },
  'רחוב הרכבת': {
    activity: 'quiet',
    lighting: { value: 0.5, source: 'municipal_open_data' },
    transit: { level: 'sparse', source: 'gtfs' },
  },
  'סמטת הגדוד העברי': {
    activity: 'quiet',
    lighting: { value: 0.28, source: 'safe_reports', ageHours: 12 },
  },
  'רחוב אבארבנאל': {
    activity: 'quiet',
    lighting: { value: 0.46, source: 'municipal_open_data' },
  },
}

function profileFor(segmentId: string): SegmentProfile {
  const segment = getSegment(segmentId)
  const named = PROFILES_BY_STREET[segment.name]
  if (named) return named
  // Unlisted street: character only, no enrichment. This is the sparse case.
  return { activity: segment.context === 'main_street' ? 'commercial' : 'quiet' }
}

/* ------------------------------------------------------------------ *
 * Live reports
 * ------------------------------------------------------------------ */

/** Per-category TTL, spec section Yod-Bet ("minutes / hours / until verified"). */
export const REPORT_TTL_MINUTES: Record<LiveReport['category'], number> = {
  poor_lighting: 24 * 60,
  blocked_passage: 12 * 60,
  feels_deserted: 90,
  disturbance: 60,
  visible_emergency_response: 45,
  all_good: 90,
}

/** How each category moves the live_reports signal. */
const REPORT_VALUE: Record<LiveReport['category'], number> = {
  poor_lighting: 0.25,
  blocked_passage: 0.3,
  feels_deserted: 0.2,
  disturbance: 0.15,
  visible_emergency_response: 0.35,
  all_good: 0.85,
}

const reports = new Map<string, LiveReport>()

export function addReport(report: LiveReport): void {
  reports.set(report.id, report)
}

export function clearReports(): void {
  reports.clear()
}

export function activeReportsFor(segmentId: string, at: Date): LiveReport[] {
  return [...reports.values()].filter(
    (r) =>
      r.segmentId === segmentId &&
      new Date(r.expiresAt).getTime() > at.getTime() &&
      new Date(r.createdAt).getTime() <= at.getTime(),
  )
}

export function allActiveReports(at: Date): LiveReport[] {
  return [...reports.values()].filter(
    (r) => new Date(r.expiresAt).getTime() > at.getTime(),
  )
}

/**
 * Trust weight for a report, spec section Yod-Bet. Never surfaced to users:
 * "the reputation weight is not visible, in order to reduce gaming."
 */
export function reportTrust(report: LiveReport): number {
  const base = 0.4
  const confirmed = Math.min(0.4, report.confirmations * 0.15)
  const disputed = Math.min(0.5, report.disputes * 0.2)
  return Math.max(0, Math.min(1, base + confirmed - disputed))
}

/* ------------------------------------------------------------------ *
 * Feature retrieval
 * ------------------------------------------------------------------ */

function feature(
  segmentId: string,
  kind: SignalKind,
  value: number,
  source: SourceId,
  at: Date,
  opts: { ttlMinutes?: number | null; confidence: number; ageMinutes?: number; corroboration?: number },
): SegmentFeature {
  const observedAt = new Date(at.getTime() - (opts.ageMinutes ?? 0) * 60_000)
  return {
    segmentId,
    kind,
    value: Math.max(0, Math.min(1, value)),
    source,
    observedAt: observedAt.toISOString(),
    expiresAt:
      opts.ttlMinutes == null
        ? null
        : new Date(observedAt.getTime() + opts.ttlMinutes * 60_000).toISOString(),
    confidence: opts.confidence,
    ...(opts.corroboration === undefined ? {} : { corroboration: opts.corroboration }),
  }
}

/**
 * All unexpired signals for a segment at time `at`.
 *
 * A signal the store has no data for is simply not in the returned array.
 * Consumers must treat that as "unknown" and lower coverage, never as a zero.
 */
export function getSegmentFeatures(segmentId: string, at: Date): SegmentFeature[] {
  const segment = getSegment(segmentId)
  const profile = profileFor(segmentId)
  const out: SegmentFeature[] = []

  // Street character. Always known - it comes from the map itself.
  out.push(
    feature(segmentId, 'street_context', STREET_CONTEXT_VALUE[segment.context], 'osm', at, {
      ttlMinutes: null,
      confidence: 0.9,
    }),
  )

  // Human activity, modelled from the hour curve.
  out.push(
    feature(
      segmentId,
      'human_activity',
      sampleCurve(ACTIVITY_CURVES[profile.activity], at),
      'safe_telemetry',
      at,
      { ttlMinutes: 30, confidence: 0.6, ageMinutes: 6 },
    ),
  )

  if (profile.lighting) {
    out.push(
      feature(segmentId, 'lighting', profile.lighting.value, profile.lighting.source, at, {
        // Municipal lighting inventory is near-static; a user lighting report is not.
        ttlMinutes: profile.lighting.source === 'safe_reports' ? 72 * 60 : null,
        confidence: profile.lighting.source === 'safe_reports' ? 0.5 : 0.85,
        ageMinutes: (profile.lighting.ageHours ?? 0) * 60,
      }),
    )
  }

  if (profile.openPlaces) {
    out.push(
      feature(
        segmentId,
        'open_places',
        sampleCurve(OPEN_PLACES_CURVES[profile.openPlaces.profile], at),
        profile.openPlaces.source,
        at,
        { ttlMinutes: 60, confidence: 0.65, ageMinutes: 10 },
      ),
    )
  }

  if (profile.transit) {
    const curve =
      profile.transit.level === 'frequent' ? TRANSIT_CURVE_FREQUENT : TRANSIT_CURVE_SPARSE
    out.push(
      feature(segmentId, 'transit_presence', sampleCurve(curve, at), profile.transit.source, at, {
        ttlMinutes: 60,
        confidence: 0.8,
      }),
    )
  }

  if (profile.historical) {
    out.push(
      feature(
        segmentId,
        'historical_context',
        profile.historical.value,
        profile.historical.source,
        at,
        {
          ttlMinutes: null,
          // Deliberately capped: this is a coarse statistical-area background
          // layer (spec section Tet lists it as "background layer only"), so it
          // must never look as certain as an observation of this street.
          confidence: 0.45,
        },
      ),
    )
  }

  const active = activeReportsFor(segmentId, at)
  if (active.length > 0) {
    const totalTrust = active.reduce((s, r) => s + reportTrust(r), 0)
    const value =
      active.reduce((s, r) => s + REPORT_VALUE[r.category] * reportTrust(r), 0) / totalTrust
    const newest = active.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
    const ageMinutes = (at.getTime() - new Date(newest.createdAt).getTime()) / 60_000
    out.push(
      feature(segmentId, 'live_reports', value, 'safe_reports', at, {
        ttlMinutes: REPORT_TTL_MINUTES[newest.category],
        confidence: Math.min(0.85, totalTrust / active.length),
        ageMinutes,
        corroboration: active.length,
      }),
    )
  }

  // Drop anything already past its expiry - the store must never serve stale
  // signals (spec section Tet: "every signal must have an expiration or
  // freshness policy").
  return out.filter((f) => f.expiresAt === null || new Date(f.expiresAt).getTime() > at.getTime())
}

export function allSegmentIds(): string[] {
  return [...SEGMENTS.keys()]
}
