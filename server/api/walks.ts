/**
 * Walk sessions and live navigation (spec sections Yod-Alef and Yod-Het).
 *
 * POST  /v1/walks                 open a session
 * PATCH /v1/walks/:id/location    position update, off-route detection
 * POST  /v1/walks/:id/reevaluate  should we offer a different route?
 * POST  /v1/walks/:id/arrive      end the session
 *
 * The behaviour the spec is most insistent about is restraint: "do not change
 * the route on every small signal; a significant improvement is required", and
 * calm messaging - "there is a better option in about seventy metres", not an
 * alarm. Both live in `reevaluate` below.
 */

import { Router } from 'express'
import type { ReevaluateResult, WalkState } from '../../shared/types.ts'
import { DEFAULT_PREFERENCES } from '../../shared/types.ts'
import { getRoutingProvider } from '../routing/provider.ts'
import { scoreRoutes } from '../safety/evaluate.ts'
import { decide } from '../safety/decisionPolicy.ts'
import { buildPayload } from '../explain/payload.ts'
import { explain } from '../explain/index.ts'
import { distanceToPathM, progressAlongPathM } from '../routing/geo.ts'
import {
  createSession,
  endSession,
  getSession,
  toPublic,
  updateSession,
} from '../state/walkSessions.ts'
import {
  OFF_ROUTE_THRESHOLD_M,
  REROUTE_MAX_EXTRA_MINUTES,
  REROUTE_MIN_SAFETY_GAIN,
} from '../safety/weights.ts'
import { BadRequest, parseLatLng, parsePreferences, parseTimestamp } from './validation.ts'

export const walksRouter: Router = Router()

walksRouter.post('/walks', async (req, res, next) => {
  try {
    const origin = parseLatLng(req.body?.origin, 'origin')
    const destination = parseLatLng(req.body?.destination, 'destination')
    const routeId = req.body?.routeId
    if (typeof routeId !== 'string' || routeId.length === 0) {
      throw new BadRequest('routeId is required')
    }
    const preferences = parsePreferences(req.body?.preferences)

    const routes = await getRoutingProvider().alternatives(origin, destination)
    if (!routes.some((r) => r.id === routeId)) {
      throw new BadRequest(`routeId "${routeId}" is not one of the current alternatives`)
    }

    const session = createSession(routeId, routes, JSON.stringify(preferences))
    res.status(201).json(session)
  } catch (error) {
    next(error)
  }
})

walksRouter.patch('/walks/:id/location', (req, res, next) => {
  try {
    const session = getSession(req.params.id)
    if (!session) {
      res.status(404).json({ error: 'walk session not found' })
      return
    }
    const position = parseLatLng(req.body?.position, 'position')
    const route = session.routes.find((r) => r.id === session.routeId)
    if (!route) throw new BadRequest('session route is no longer available')

    const deviationM = distanceToPathM(position, route.geometry)
    const offRoute = deviationM > OFF_ROUTE_THRESHOLD_M

    const state: WalkState = offRoute ? 'OFF_ROUTE' : 'WALKING'
    const updated = updateSession(session.id, {
      state,
      lastKnownPosition: position,
      progressM: Math.round(progressAlongPathM(position, route.geometry)),
    })

    res.json({
      session: updated,
      deviationM: Math.round(deviationM),
      offRoute,
      remainingM: Math.max(0, Math.round(route.distanceM - (updated?.progressM ?? 0))),
    })
  } catch (error) {
    next(error)
  }
})

walksRouter.post('/walks/:id/reevaluate', async (req, res, next) => {
  try {
    const session = getSession(req.params.id)
    if (!session) {
      res.status(404).json({ error: 'walk session not found' })
      return
    }
    const at = parseTimestamp(req.body?.at, 'at') ?? new Date()
    const preferences = session.preferencesJson
      ? (JSON.parse(session.preferencesJson) as typeof DEFAULT_PREFERENCES)
      : DEFAULT_PREFERENCES

    const { scored, facts } = scoreRoutes(session.routes, at, preferences)
    const current = scored.find((r) => r.id === session.routeId)
    if (!current) throw new BadRequest('session route is no longer available')

    const best = [...scored].sort((a, b) => b.utility - a.utility)[0]!

    const gain = best.safetyScore - current.safetyScore
    const extraMinutes = (best.durationS - current.durationS) / 60

    // Hysteresis (spec section Yod-Alef): a change has to clear BOTH bars, or
    // the product nags. Small signal drift must not move anyone.
    const worthOffering =
      best.id !== current.id &&
      gain >= REROUTE_MIN_SAFETY_GAIN &&
      extraMinutes <= REROUTE_MAX_EXTRA_MINUTES

    if (!worthOffering) {
      const result: ReevaluateResult = { changed: false, alternative: null, message: null }
      res.json(result)
      return
    }

    const recommendation = decide([current, best], preferences)
    const payload = buildPayload(recommendation, scored, facts)
    const explanation = await explain(payload)

    const extraText =
      extraMinutes < 1.5 ? 'כדקה' : `כ-${Math.round(extraMinutes)} דקות`
    const result: ReevaluateResult = {
      changed: true,
      alternative: {
        routeId: best.id,
        extraTimeS: Math.max(0, best.durationS - current.durationS),
        explanation,
        triggeredBy: current.reasonCodes.filter(
          (c) => c === 'recent_report' || c === 'low_activity' || c === 'poor_lighting',
        ),
      },
      // Calm, specific, no alarm - spec section Yod-Alef.
      message: `יש כרגע אפשרות עדיפה. היא מוסיפה ${extraText} ועוקפת את המקטע הפחות מתאים.`,
    }
    res.json(result)
  } catch (error) {
    next(error)
  }
})

walksRouter.post('/walks/:id/accept', (req, res, next) => {
  try {
    const session = getSession(req.params.id)
    if (!session) {
      res.status(404).json({ error: 'walk session not found' })
      return
    }
    const routeId = req.body?.routeId
    if (!session.routes.some((r) => r.id === routeId)) {
      throw new BadRequest('routeId is not one of this session\'s alternatives')
    }
    res.json(updateSession(session.id, { routeId, state: 'WALKING' }))
  } catch (error) {
    next(error)
  }
})

walksRouter.post('/walks/:id/arrive', (req, res) => {
  const session = getSession(req.params.id)
  if (!session) {
    res.status(404).json({ error: 'walk session not found' })
    return
  }
  const cancelled = req.body?.cancelled === true
  res.json(endSession(session.id, cancelled ? 'CANCELLED' : 'ARRIVED'))
})

walksRouter.get('/walks/:id', (req, res) => {
  const session = getSession(req.params.id)
  if (!session) {
    res.status(404).json({ error: 'walk session not found' })
    return
  }
  res.json(toPublic(session))
})
