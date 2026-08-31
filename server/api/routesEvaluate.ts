/**
 * POST /v1/routes/evaluate  (spec section Yod-Het)
 *
 * A/B plus preferences in, routes plus recommendation plus reasons out.
 * This is the whole product in one call: everything the recommendation screen
 * (S02) and the "why this route?" screen (S03) need.
 */

import { Router } from 'express'
import type { EvaluateResponse } from '../../shared/types.ts'
import { evaluate } from '../safety/evaluate.ts'
import { buildPayload } from '../explain/payload.ts'
import { explain } from '../explain/index.ts'
import { parseLatLng, parsePreferences, parseTimestamp } from './validation.ts'

export const routesRouter: Router = Router()

routesRouter.post('/routes/evaluate', async (req, res, next) => {
  try {
    const origin = parseLatLng(req.body?.origin, 'origin')
    const destination = parseLatLng(req.body?.destination, 'destination')
    const at = parseTimestamp(req.body?.at, 'at')
    const preferences = parsePreferences(req.body?.preferences)

    const result = await evaluate(origin, destination, { at, preferences })
    const payload = buildPayload(result.recommendation, result.routes, result.facts)
    const explanation = await explain(payload)

    const body: EvaluateResponse = {
      routes: result.routes,
      recommendation: result.recommendation,
      explanation,
      evaluatedAt: result.at.toISOString(),
      modelVersion: result.modelVersion,
    }
    res.json(body)
  } catch (error) {
    next(error)
  }
})

/**
 * GET /v1/segments/:id/explain  (spec section Yod-Het)
 *
 * The detail behind a single segment: which signals contributed, from which
 * source, and how old they are. This is what makes "why this route?" auditable
 * rather than a story.
 */
routesRouter.get('/segments/:id/explain', (req, res, next) => {
  try {
    const at = parseTimestamp(req.query.at, 'at') ?? new Date()
    const segmentId = req.params.id
    // Imported lazily to keep this module's import graph flat.
    void import('../safety/signalStore.ts').then(async ({ getSegmentFeatures }) => {
      const { scoreSegment } = await import('../safety/segmentScore.ts')
      const { getSegment } = await import('../routing/graph.ts')
      const segment = getSegment(segmentId)
      const features = getSegmentFeatures(segmentId, at)
      res.json({
        segment: { id: segment.id, name: segment.name, context: segment.context, lengthM: Math.round(segment.lengthM) },
        score: scoreSegment(segmentId, features, at),
        features,
        evaluatedAt: at.toISOString(),
      })
    }).catch(next)
  } catch (error) {
    next(error)
  }
})
