/**
 * SAFE WALK - core domain types.
 *
 * Mirrors the entity list in spec section Yod-Het (Data model & internal API).
 * Shared by server and client so the wire format has exactly one definition.
 */

export interface LatLng {
  lat: number
  lng: number
}

/* ------------------------------------------------------------------ *
 * Street segments
 * ------------------------------------------------------------------ */

/**
 * The static character of a segment. Deliberately about the *street*, never
 * about the people on it - see spec section Het, "no protected demographic
 * attributes of an area or of people as a signal".
 */
export type StreetContext =
  | 'main_street'
  | 'secondary_street'
  | 'residential'
  | 'alley'
  | 'park_path'
  | 'parking_lot'
  | 'isolated_passage'
  | 'promenade'

export interface StreetSegment {
  id: string
  /** Human-readable street name, used only for display and explanations. */
  name: string
  from: string
  to: string
  geometry: LatLng[]
  context: StreetContext
  /** Metres. Derived from geometry at load time. */
  lengthM: number
}

/* ------------------------------------------------------------------ *
 * Signals / features
 * ------------------------------------------------------------------ */

export type SignalKind =
  | 'human_activity'
  | 'lighting'
  | 'street_context'
  | 'open_places'
  | 'transit_presence'
  | 'live_reports'
  | 'historical_context'

/**
 * Where a signal came from. Reliability ordering is defined in
 * server/safety/confidence.ts, per spec section Yod-Gimel.
 */
export type SourceId =
  | 'osm'
  | 'municipal_open_data'
  | 'gtfs'
  | 'police_historical'
  | 'poi_provider'
  | 'safe_reports'
  | 'safe_telemetry'
  | 'mock'

export interface SegmentFeature {
  segmentId: string
  kind: SignalKind
  /** Normalised 0..1, where 1 is the more favourable end of the signal. */
  value: number
  source: SourceId
  observedAt: string
  /** ISO timestamp, or null for effectively static facts (e.g. street type). */
  expiresAt: string | null
  /** How much we trust this individual observation, 0..1. */
  confidence: number
  /** How many independent observations back this value. */
  corroboration?: number
}

export interface SegmentScore {
  segmentId: string
  /** 0..100. Higher = conditions the model treats as preferable. */
  score: number
  /** 0..1, independent of score. See spec section Yod-Gimel. */
  confidence: number
  /** Share of the weight budget backed by present, unexpired signals. */
  coverage: number
  contributions: SignalContribution[]
  modelVersion: string
}

export interface SignalContribution {
  kind: SignalKind
  value: number
  weight: number
  /** value * normalisedWeight - what actually moved the score. */
  effect: number
  source: SourceId
  ageMinutes: number
}

/* ------------------------------------------------------------------ *
 * Routes
 * ------------------------------------------------------------------ */

export interface Route {
  id: string
  segmentIds: string[]
  geometry: LatLng[]
  distanceM: number
  durationS: number
}

export interface ScoredRoute extends Route {
  /** 0..100, aggregated per spec section Het (not a plain mean). */
  safetyScore: number
  confidence: number
  coverage: number
  /** The single worst meaningful segment, which the aggregation refuses to hide. */
  weakestSegment: { segmentId: string; name: string; score: number } | null
  segmentScores: SegmentScore[]
  /** Decision-policy utility. Comparable only within one evaluation. */
  utility: number
  reasonCodes: ReasonCode[]
}

/* ------------------------------------------------------------------ *
 * Reason codes - the contract with the explanation layer
 * ------------------------------------------------------------------ */

/**
 * A closed vocabulary. The explanation engine may only ever speak about codes
 * in this list, and the Safety Engine is the only thing that can emit them.
 * This is what makes "the AI explains, it does not decide" structural rather
 * than a prompt instruction (spec sections Gimel and Yod).
 */
export type ReasonCode =
  // positives
  | 'main_street'
  | 'open_places'
  | 'active_transit'
  | 'well_lit'
  | 'human_activity'
  | 'shorter_route'
  // negatives
  | 'low_activity'
  | 'poor_lighting'
  | 'isolated_segment'
  | 'park_at_night'
  | 'recent_report'
  | 'long_detour'
  // meta
  | 'sparse_data'
  | 'negligible_difference'

export type ReasonPolarity = 'positive' | 'negative' | 'meta'

/* ------------------------------------------------------------------ *
 * Decision
 * ------------------------------------------------------------------ */

export type ConfidenceBand = 'high' | 'medium' | 'low'

export interface Recommendation {
  recommendedRouteId: string
  fastestRouteId: string
  /** Seconds the recommendation costs over the fastest option. Never negative. */
  extraTimeS: number
  confidence: ConfidenceBand
  /** Codes in favour of the recommended route. */
  positives: ReasonCode[]
  /** Codes counting against the alternative that was not chosen. */
  alternativeNegatives: ReasonCode[]
  /** Why the policy landed here, in engine terms. For the UI and the audit log. */
  policyNote: string
}

export interface EvaluateRequest {
  origin: LatLng
  destination: LatLng
  /** ISO timestamp. Defaults to now; explicit so scenarios are reproducible. */
  at?: string
  preferences?: SafetyPreferences
}

export interface EvaluateResponse {
  routes: ScoredRoute[]
  recommendation: Recommendation
  explanation: Explanation
  evaluatedAt: string
  modelVersion: string
}

/* ------------------------------------------------------------------ *
 * Preferences (spec section Tet-Vav)
 * ------------------------------------------------------------------ */

export type DetourTolerance = 3 | 5 | 10 | 'auto'
export type PreferenceLevel = 'low' | 'normal' | 'high'

export interface SafetyPreferences {
  maxDetourMinutes: DetourTolerance
  preferMainStreets: PreferenceLevel
  avoidParksAtNight: boolean
  preferOpenPlaces: PreferenceLevel
  preferLitRoutes: PreferenceLevel
}

export const DEFAULT_PREFERENCES: SafetyPreferences = {
  maxDetourMinutes: 'auto',
  preferMainStreets: 'normal',
  avoidParksAtNight: true,
  preferOpenPlaces: 'normal',
  preferLitRoutes: 'normal',
}

/* ------------------------------------------------------------------ *
 * Explanation
 * ------------------------------------------------------------------ */

export type ExplanationSource = 'llm' | 'template'

export interface Explanation {
  text: string
  source: ExplanationSource
  /** Set when an LLM draft was produced but rejected, and why. */
  fallbackReason?: string
  reasonCodes: ReasonCode[]
}

/* ------------------------------------------------------------------ *
 * Walk sessions (spec section Yod-Alef)
 * ------------------------------------------------------------------ */

export type WalkState =
  | 'IDLE'
  | 'ROUTE_SELECTED'
  | 'WALKING'
  | 'OFF_ROUTE'
  | 'RECOMPUTE'
  | 'ARRIVED'
  | 'CANCELLED'

export interface WalkSession {
  id: string
  routeId: string
  state: WalkState
  startedAt: string
  endedAt: string | null
  /** Only the current position is kept, per spec section Yod-Tet. */
  lastKnownPosition: LatLng | null
  progressM: number
}

export interface ReevaluateResult {
  changed: boolean
  /** Present only when the policy decided a change is worth offering. */
  alternative: {
    routeId: string
    extraTimeS: number
    explanation: Explanation
    triggeredBy: ReasonCode[]
  } | null
  message: string | null
}

/* ------------------------------------------------------------------ *
 * Live reports (spec section Yod-Bet)
 * ------------------------------------------------------------------ */

export type ReportCategory =
  | 'poor_lighting'
  | 'blocked_passage'
  | 'feels_deserted'
  | 'disturbance'
  | 'visible_emergency_response'
  | 'all_good'

export interface LiveReport {
  id: string
  category: ReportCategory
  position: LatLng
  segmentId: string | null
  createdAt: string
  expiresAt: string
  note?: string
  confirmations: number
  disputes: number
  /** Derived weight, 0..1. Never shown to users - see spec section Yod-Bet. */
  trust: number
}
