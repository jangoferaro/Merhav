/**
 * Walk session store.
 *
 * Spec section Yod-Tet, privacy by design: "precise location is used for
 * navigation during the session; the default is to minimise retention after
 * arrival." So this store keeps only the LAST known position, never a trail,
 * and drops it entirely on arrival or cancellation. In-memory in Phase 0,
 * which also means nothing survives a restart.
 */

import type { LatLng, Route, WalkSession, WalkState } from '../../shared/types.ts'

interface StoredSession extends WalkSession {
  /** Kept server-side to re-evaluate without re-routing. */
  routes: Route[]
  preferencesJson: string
}

const sessions = new Map<string, StoredSession>()

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`
}

export function createSession(routeId: string, routes: Route[], preferencesJson: string): WalkSession {
  const session: StoredSession = {
    id: nextId('walk'),
    routeId,
    state: 'ROUTE_SELECTED',
    startedAt: new Date().toISOString(),
    endedAt: null,
    lastKnownPosition: null,
    progressM: 0,
    routes,
    preferencesJson,
  }
  sessions.set(session.id, session)
  return toPublic(session)
}

export function getSession(id: string): StoredSession | undefined {
  return sessions.get(id)
}

export function updateSession(
  id: string,
  patch: Partial<Pick<StoredSession, 'state' | 'lastKnownPosition' | 'progressM' | 'routeId' | 'endedAt'>>,
): WalkSession | undefined {
  const session = sessions.get(id)
  if (!session) return undefined
  Object.assign(session, patch)

  // Terminal states drop the position immediately - retention minimisation is
  // a behaviour, not a nightly cleanup job.
  if (session.state === 'ARRIVED' || session.state === 'CANCELLED') {
    session.lastKnownPosition = null
    session.endedAt ??= new Date().toISOString()
  }
  return toPublic(session)
}

export function endSession(id: string, state: Extract<WalkState, 'ARRIVED' | 'CANCELLED'>): WalkSession | undefined {
  return updateSession(id, { state, endedAt: new Date().toISOString() })
}

export function deleteSession(id: string): boolean {
  return sessions.delete(id)
}

export function clearSessions(): void {
  sessions.clear()
}

export function toPublic(session: StoredSession): WalkSession {
  const { routes: _routes, preferencesJson: _prefs, ...rest } = session
  return rest
}
