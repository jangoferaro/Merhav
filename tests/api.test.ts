/**
 * End-to-end tests over the real HTTP surface (spec section Yod-Het).
 *
 * Runs the actual Express app on an ephemeral port, so routing, validation,
 * error shapes and JSON serialisation are all exercised as a client sees them.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Server } from 'node:http'
import { createApp } from '../server/index.ts'
import { clearReports } from '../server/safety/signalStore.ts'
import { clearSessions } from '../server/state/walkSessions.ts'
import { _resetReports } from '../server/api/reports.ts'
import { CITY_CENTRE, FLORENTIN, NIGHT } from './helpers.ts'

let server: Server
let base: string

beforeAll(async () => {
  server = createApp().listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('no port')
  base = `http://127.0.0.1:${address.port}`
})

afterAll(() => {
  server.close()
})

beforeEach(() => {
  clearReports()
  clearSessions()
  _resetReports()
})

const post = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const patch = (path: string, body: unknown) =>
  fetch(`${base}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const evaluateBody = { origin: FLORENTIN, destination: CITY_CENTRE, at: NIGHT.toISOString() }

describe('POST /v1/routes/evaluate', () => {
  it('returns routes, a recommendation and an explanation', async () => {
    const response = await post('/v1/routes/evaluate', evaluateBody)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.routes.length).toBeGreaterThanOrEqual(2)
    expect(body.recommendation.recommendedRouteId).toBeTruthy()
    expect(body.explanation.text.length).toBeGreaterThan(0)
    expect(body.explanation.source).toBe('template')
    expect(body.modelVersion).toMatch(/^safe-score-/)
  })

  it('honours a stricter detour preference', async () => {
    const strict = await post('/v1/routes/evaluate', {
      ...evaluateBody,
      preferences: { maxDetourMinutes: 3, preferMainStreets: 'low', preferOpenPlaces: 'low', preferLitRoutes: 'low', avoidParksAtNight: true },
    })
    const body = await strict.json()
    const rec = body.routes.find((r: { id: string }) => r.id === body.recommendation.recommendedRouteId)
    const fastest = body.routes.find((r: { id: string }) => r.id === body.recommendation.fastestRouteId)
    expect((rec.durationS - fastest.durationS) / 60).toBeLessThanOrEqual(3)
  })

  it('rejects coordinates outside the coverage area', async () => {
    const response = await post('/v1/routes/evaluate', {
      origin: { lat: 48.85, lng: 2.35 },
      destination: CITY_CENTRE,
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/coverage area/)
  })

  it('rejects a malformed origin', async () => {
    const response = await post('/v1/routes/evaluate', { origin: 'here', destination: CITY_CENTRE })
    expect(response.status).toBe(400)
  })

  it('rejects an invalid preference value', async () => {
    const response = await post('/v1/routes/evaluate', {
      ...evaluateBody,
      preferences: { maxDetourMinutes: 45 },
    })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/maxDetourMinutes/)
  })

  it('reports 422 with a code when no route exists', async () => {
    const response = await post('/v1/routes/evaluate', {
      origin: FLORENTIN,
      destination: FLORENTIN,
    })
    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe('NO_ROUTE')
  })
})

describe('GET /v1/segments/:id/explain', () => {
  it('shows which signals contributed, from where, and how old they are', async () => {
    const evaluation = await (await post('/v1/routes/evaluate', evaluateBody)).json()
    const segmentId = evaluation.routes[0].segmentIds[0]

    const body = await (
      await fetch(`${base}/v1/segments/${segmentId}/explain?at=${NIGHT.toISOString()}`)
    ).json()

    expect(body.segment.name).toBeTruthy()
    expect(body.features.length).toBeGreaterThan(0)
    for (const feature of body.features) {
      expect(feature.source).toBeTruthy()
      expect(feature.observedAt).toBeTruthy()
      expect(feature).toHaveProperty('expiresAt')
    }
    expect(body.score.contributions.length).toBeGreaterThan(0)
  })
})

describe('walk sessions', () => {
  async function startWalk() {
    const evaluation = await (await post('/v1/routes/evaluate', evaluateBody)).json()
    const routeId = evaluation.recommendation.recommendedRouteId
    const session = await (
      await post('/v1/walks', { origin: FLORENTIN, destination: CITY_CENTRE, routeId })
    ).json()
    return { evaluation, session, routeId }
  }

  it('opens a session in ROUTE_SELECTED with no position yet', async () => {
    const { session } = await startWalk()
    expect(session.state).toBe('ROUTE_SELECTED')
    expect(session.lastKnownPosition).toBeNull()
  })

  it('rejects a routeId that is not one of the alternatives', async () => {
    const response = await post('/v1/walks', {
      origin: FLORENTIN,
      destination: CITY_CENTRE,
      routeId: 'not-a-route',
    })
    expect(response.status).toBe(400)
  })

  it('tracks progress on-route and flags a deviation', async () => {
    const { session, evaluation, routeId } = await startWalk()
    const route = evaluation.routes.find((r: { id: string }) => r.id === routeId)

    const onRoute = await (
      await patch(`/v1/walks/${session.id}/location`, { position: route.geometry[1] })
    ).json()
    expect(onRoute.offRoute).toBe(false)
    expect(onRoute.session.state).toBe('WALKING')
    expect(onRoute.remainingM).toBeLessThan(route.distanceM)

    const strayed = {
      lat: route.geometry[1].lat + 0.004,
      lng: route.geometry[1].lng + 0.004,
    }
    const off = await (await patch(`/v1/walks/${session.id}/location`, { position: strayed })).json()
    expect(off.offRoute).toBe(true)
    expect(off.session.state).toBe('OFF_ROUTE')
  })

  it('does not offer a reroute when nothing meaningful changed', async () => {
    const { session } = await startWalk()
    const result = await (
      await post(`/v1/walks/${session.id}/reevaluate`, { at: NIGHT.toISOString() })
    ).json()
    expect(result.changed).toBe(false)
    expect(result.message).toBeNull()
  })

  it('drops the stored position on arrival', async () => {
    const { session, evaluation, routeId } = await startWalk()
    const route = evaluation.routes.find((r: { id: string }) => r.id === routeId)
    await patch(`/v1/walks/${session.id}/location`, { position: route.geometry[1] })

    const arrived = await (await post(`/v1/walks/${session.id}/arrive`, {})).json()
    expect(arrived.state).toBe('ARRIVED')
    expect(arrived.lastKnownPosition).toBeNull()
    expect(arrived.endedAt).toBeTruthy()
  })

  it('404s for an unknown session', async () => {
    expect((await post('/v1/walks/nope/reevaluate', {})).status).toBe(404)
  })
})

describe('live reports', () => {
  it('creates a report with a TTL and attaches it to a street', async () => {
    const response = await post('/v1/reports', {
      category: 'poor_lighting',
      position: FLORENTIN,
      note: 'הפנס בפינה כבוי',
    })
    expect(response.status).toBe(201)

    const report = await response.json()
    expect(report.segmentId).toBeTruthy()
    expect(new Date(report.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('never exposes the trust weight', async () => {
    // Spec section Yod-Bet: hidden specifically to reduce gaming.
    const report = await (await post('/v1/reports', { category: 'disturbance', position: FLORENTIN })).json()
    expect(report).not.toHaveProperty('trust')

    const confirmed = await (await post(`/v1/reports/${report.id}/confirm`, { agree: true })).json()
    expect(confirmed).not.toHaveProperty('trust')
    expect(confirmed.confirmations).toBe(1)
  })

  it('rejects an unknown category', async () => {
    const response = await post('/v1/reports', { category: 'zombies', position: FLORENTIN })
    expect(response.status).toBe(400)
  })

  it('rejects an over-long note', async () => {
    const response = await post('/v1/reports', {
      category: 'disturbance',
      position: FLORENTIN,
      note: 'x'.repeat(400),
    })
    expect(response.status).toBe(400)
  })

  it('a fresh confirmed report changes the recommendation inputs', async () => {
    const before = await (await post('/v1/routes/evaluate', {
      origin: FLORENTIN, destination: CITY_CENTRE,
    })).json()

    const midRoute = before.routes[1].geometry[2]
    const report = await (await post('/v1/reports', { category: 'disturbance', position: midRoute })).json()
    await post(`/v1/reports/${report.id}/confirm`, { agree: true })

    const after = await (await post('/v1/routes/evaluate', {
      origin: FLORENTIN, destination: CITY_CENTRE,
    })).json()

    const scoreOf = (body: { routes: { id: string; safetyScore: number }[] }, id: string) =>
      body.routes.find((r) => r.id === id)!.safetyScore
    expect(scoreOf(after, before.routes[1].id)).not.toBe(scoreOf(before, before.routes[1].id))
  })
})

describe('GET /v1/health/data-feeds', () => {
  it('reports the engine configuration and explanation mode', async () => {
    const body = await (await fetch(`${base}/v1/health/data-feeds`)).json()
    expect(body.status).toBe('ok')
    expect(body.routing.segments).toBeGreaterThan(0)
    expect(body.explanation.mode).toBe('template_only')
    expect(body.modelConfig.version).toMatch(/^safe-score-/)
  })
})

describe('GET /v1/places', () => {
  it('filters junctions by name', async () => {
    const body = await (await fetch(`${base}/v1/places?q=${encodeURIComponent('אלנבי')}`)).json()
    expect(body.places.length).toBeGreaterThan(0)
    for (const place of body.places) expect(place.name).toContain('אלנבי')
  })
})

describe('error handling', () => {
  it('404s an unknown path as JSON', async () => {
    const response = await fetch(`${base}/v1/nope`)
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('not found')
  })
})
