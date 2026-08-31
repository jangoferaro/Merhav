/**
 * GET /v1/health/data-feeds  (spec section Yod-Het, admin only)
 *
 * The Data feed health module from section Tet-Zayin, in its smallest useful
 * form: what the engine is running on, and whether the explanation layer is
 * actually being used or is falling back. A rising `rejected` count is the
 * signal that the model is drifting into claims the guardrails refuse.
 */

import { Router } from 'express'
import { config } from '../env.ts'
import { MODEL_CONFIG } from '../safety/weights.ts'
import { explanationStats } from '../explain/index.ts'
import { SEGMENTS } from '../routing/graph.ts'
import { allActiveReports } from '../safety/signalStore.ts'

export const healthRouter: Router = Router()

healthRouter.get('/health/data-feeds', (_req, res) => {
  res.json({
    status: 'ok',
    routing: { provider: config.routingProvider, segments: SEGMENTS.size },
    explanation: {
      model: config.hasExplanationModel ? config.explanationModel : null,
      // The honest headline: with no key, every explanation is deterministic.
      mode: config.hasExplanationModel ? 'llm_with_template_fallback' : 'template_only',
      ...explanationStats,
    },
    reports: { active: allActiveReports(new Date()).length },
    // Exposed so a config change is visible and diffable (spec section Tet-Zayin).
    modelConfig: MODEL_CONFIG,
  })
})
