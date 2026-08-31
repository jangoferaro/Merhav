/**
 * SAFE WALK API server.
 *
 * Phase 0 keeps everything in one process. The seams that matter later -
 * routing provider, feature store, explanation service - are already modules
 * with their own interfaces, so splitting them into the services listed in
 * spec section Yod-Zayin is a deployment change rather than a rewrite.
 */

import express from 'express'
import { config } from './env.ts'
import { routesRouter } from './api/routesEvaluate.ts'
import { walksRouter } from './api/walks.ts'
import { reportsRouter } from './api/reports.ts'
import { healthRouter } from './api/health.ts'
import { placesRouter } from './api/places.ts'

export function createApp() {
  const app = express()
  app.use(express.json({ limit: '64kb' }))

  app.use('/v1', routesRouter)
  app.use('/v1', walksRouter)
  app.use('/v1', reportsRouter)
  app.use('/v1', healthRouter)
  app.use('/v1', placesRouter)

  app.use((_req, res) => {
    res.status(404).json({ error: 'not found' })
  })

  app.use(
    (
      error: Error & { status?: number; code?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      const status = error.status ?? 500
      if (status >= 500) console.error('[safe-walk]', error)
      res.status(status).json({
        error: status >= 500 ? 'internal error' : error.message,
        ...(error.code ? { code: error.code } : {}),
      })
    },
  )

  return app
}

// Only listen when run directly, so tests can import createApp() freely.
const isMain = process.argv[1]?.endsWith('server/index.ts')
if (isMain) {
  createApp().listen(config.port, () => {
    console.log(`SAFE WALK API on http://localhost:${config.port}`)
    if (!config.hasExplanationModel) {
      console.log('No ANTHROPIC_API_KEY: explanations use the deterministic template engine.')
    }
  })
}
