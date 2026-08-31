/**
 * Thin client for the SAFE WALK API.
 *
 * Deliberately dumb: it does not compute scores, choose routes or decide what
 * to say. Everything the UI renders comes from the server's evaluation, so
 * there is exactly one place where the recommendation is made.
 */

import type {
  EvaluateResponse,
  LatLng,
  LiveReport,
  ReevaluateResult,
  ReportCategory,
  SafetyPreferences,
  WalkSession,
} from '@shared/types.ts'

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(
      (body as { error?: string }).error ?? 'שגיאת רשת',
      response.status,
      (body as { code?: string }).code,
    )
  }
  return body as T
}

export interface Place {
  id: string
  name: string
  position: LatLng
}

export const api = {
  places: (query: string) =>
    request<{ places: Place[] }>(`/places?q=${encodeURIComponent(query)}`),

  evaluate: (body: {
    origin: LatLng
    destination: LatLng
    at?: string
    preferences?: SafetyPreferences
  }) => request<EvaluateResponse>('/routes/evaluate', { method: 'POST', body: JSON.stringify(body) }),

  segmentDetail: (segmentId: string, at?: string) =>
    request<{
      segment: { id: string; name: string; context: string; lengthM: number }
      score: { score: number; confidence: number; coverage: number; contributions: { kind: string; value: number; source: string; ageMinutes: number }[] }
    }>(`/segments/${encodeURIComponent(segmentId)}/explain${at ? `?at=${encodeURIComponent(at)}` : ''}`),

  startWalk: (body: { origin: LatLng; destination: LatLng; routeId: string; preferences?: SafetyPreferences }) =>
    request<WalkSession>('/walks', { method: 'POST', body: JSON.stringify(body) }),

  updateLocation: (walkId: string, position: LatLng) =>
    request<{ session: WalkSession; deviationM: number; offRoute: boolean; remainingM: number }>(
      `/walks/${walkId}/location`,
      { method: 'PATCH', body: JSON.stringify({ position }) },
    ),

  reevaluate: (walkId: string, at?: string) =>
    request<ReevaluateResult>(`/walks/${walkId}/reevaluate`, {
      method: 'POST',
      body: JSON.stringify({ at }),
    }),

  acceptRoute: (walkId: string, routeId: string) =>
    request<WalkSession>(`/walks/${walkId}/accept`, {
      method: 'POST',
      body: JSON.stringify({ routeId }),
    }),

  arrive: (walkId: string, cancelled = false) =>
    request<WalkSession>(`/walks/${walkId}/arrive`, {
      method: 'POST',
      body: JSON.stringify({ cancelled }),
    }),

  report: (body: { category: ReportCategory; position: LatLng; note?: string }) =>
    request<Omit<LiveReport, 'trust'>>('/reports', { method: 'POST', body: JSON.stringify(body) }),
}
