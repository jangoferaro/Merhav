/**
 * Live reports (spec section Yod-Bet).
 *
 * POST /v1/reports              create
 * POST /v1/reports/:id/confirm  confirm or dispute
 * GET  /v1/reports              active reports, for the map layer
 *
 * The lifecycle the spec asks for is create -> classify -> trust -> geo-match
 * -> expire -> confirm/dispute -> moderate. Phase 0 implements all of it
 * except moderation, which needs the admin surface.
 *
 * Abuse prevention that is structural rather than a to-do:
 *   - every report gets a TTL by category, so nothing accumulates forever;
 *   - a single report cannot raise a sharp alert on its own - trust starts
 *     below 0.5 and only corroboration lifts it;
 *   - the trust weight is never returned to clients, to reduce gaming.
 */

import { Router } from 'express'
import type { LiveReport, ReportCategory } from '../../shared/types.ts'
import {
  REPORT_TTL_MINUTES,
  addReport,
  allActiveReports,
  reportTrust,
} from '../safety/signalStore.ts'
import { SEGMENTS } from '../routing/graph.ts'
import { distanceToPathM } from '../routing/geo.ts'
import { BadRequest, parseLatLng } from './validation.ts'

export const reportsRouter: Router = Router()

const CATEGORIES: ReportCategory[] = [
  'poor_lighting',
  'blocked_passage',
  'feels_deserted',
  'disturbance',
  'visible_emergency_response',
  'all_good',
]

/** Furthest a report can sit from a street and still be attached to it. */
const GEO_MATCH_MAX_M = 60

const store = new Map<string, LiveReport>()
let seq = 0

/** Geo-match step: attach the report to the nearest street segment. */
function matchSegment(position: { lat: number; lng: number }): string | null {
  let best: string | null = null
  let bestDist = GEO_MATCH_MAX_M
  for (const segment of SEGMENTS.values()) {
    const d = distanceToPathM(position, segment.geometry)
    if (d < bestDist) {
      bestDist = d
      best = segment.id
    }
  }
  return best
}

/** Never expose the trust weight (spec section Yod-Bet). */
function toPublic(report: LiveReport) {
  const { trust: _trust, ...rest } = report
  return rest
}

reportsRouter.post('/reports', (req, res, next) => {
  try {
    const category = req.body?.category
    if (!CATEGORIES.includes(category)) {
      throw new BadRequest(`category must be one of ${CATEGORIES.join(', ')}`)
    }
    const position = parseLatLng(req.body?.position, 'position')

    const note = req.body?.note
    if (note !== undefined && (typeof note !== 'string' || note.length > 280)) {
      throw new BadRequest('note must be a string of at most 280 characters')
    }

    const now = new Date()
    seq += 1
    const report: LiveReport = {
      id: `rep_${now.getTime().toString(36)}${seq.toString(36)}`,
      category,
      position,
      segmentId: matchSegment(position),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + REPORT_TTL_MINUTES[category as ReportCategory] * 60_000).toISOString(),
      ...(note ? { note } : {}),
      confirmations: 0,
      disputes: 0,
      trust: 0,
    }
    report.trust = reportTrust(report)

    store.set(report.id, report)
    addReport(report)
    res.status(201).json(toPublic(report))
  } catch (error) {
    next(error)
  }
})

reportsRouter.post('/reports/:id/confirm', (req, res, next) => {
  try {
    const report = store.get(req.params.id)
    if (!report) {
      res.status(404).json({ error: 'report not found' })
      return
    }
    const agree = req.body?.agree
    if (typeof agree !== 'boolean') throw new BadRequest('agree must be a boolean')

    if (agree) report.confirmations += 1
    else report.disputes += 1
    report.trust = reportTrust(report)
    addReport(report)

    res.json(toPublic(report))
  } catch (error) {
    next(error)
  }
})

reportsRouter.get('/reports', (_req, res) => {
  res.json({ reports: allActiveReports(new Date()).map(toPublic) })
})

/** Test seam: reset module state between runs. */
export function _resetReports(): void {
  store.clear()
  seq = 0
}
