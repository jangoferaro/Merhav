/**
 * Destination search for screen S01.
 *
 * Phase 0 geocodes against the built-in graph's named junctions. A real
 * geocoder replaces this endpoint without touching the client.
 */

import { Router } from 'express'
import { NODES } from '../routing/graph.ts'

export const placesRouter: Router = Router()

placesRouter.get('/places', (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const matches = query.length === 0 ? NODES : NODES.filter((n) => n.name.includes(query))
  res.json({
    places: matches.slice(0, 10).map((n) => ({ id: n.id, name: n.name, position: n.position })),
  })
})
