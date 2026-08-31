/**
 * A hand-authored pedestrian graph covering Florentin to the Allenby /
 * Nahalat Binyamin area of Tel Aviv-Yafo.
 *
 * Why a hand-authored graph in Phase 0: the spec's open question list asks
 * whether the MVP uses Mapbox or OSM plus another engine, and that is not
 * settled yet. Hard-coding a small real-world slice lets the Safety Engine,
 * the decision policy and the explanation layer be built and tested for real
 * without betting on either answer, and without a network dependency or an
 * API key. server/routing/provider.ts is the seam where a real provider drops
 * in; nothing above it knows which one produced the alternatives.
 *
 * Coordinates are approximate but internally consistent - all distances and
 * ETAs in the product are derived from them by haversine, never hard-coded.
 */

import type { LatLng, StreetContext, StreetSegment } from '../../shared/types.ts'
import { haversineM } from './geo.ts'

export interface GraphNode {
  id: string
  name: string
  position: LatLng
}

interface EdgeSpec {
  from: string
  to: string
  name: string
  context: StreetContext
}

export const NODES: GraphNode[] = [
  { id: 'flo_herzl', name: 'פלורנטין / הרצל', position: { lat: 32.0562, lng: 34.7688 } },
  { id: 'flo_vital', name: 'פלורנטין / ויטל', position: { lat: 32.0553, lng: 34.7674 } },
  { id: 'flo_melacha', name: 'פלורנטין / המלאכה', position: { lat: 32.0565, lng: 34.7700 } },
  { id: 'vital_levinsky', name: 'ויטל / לוינסקי', position: { lat: 32.0578, lng: 34.7679 } },
  { id: 'herzl_levinsky', name: 'הרצל / לוינסקי', position: { lat: 32.0584, lng: 34.7684 } },
  { id: 'nahalat_levinsky', name: 'נחלת בנימין / לוינסקי', position: { lat: 32.0586, lng: 34.7706 } },
  { id: 'melacha_yehuda', name: 'המלאכה / יהודה הלוי', position: { lat: 32.0574, lng: 34.7736 } },
  { id: 'herzl_mid', name: 'הרצל / מרכז', position: { lat: 32.0608, lng: 34.7678 } },
  { id: 'nahalat_mid', name: 'נחלת בנימין / רמב״ם', position: { lat: 32.0616, lng: 34.7710 } },
  { id: 'yehuda_mid', name: 'יהודה הלוי / מרכז', position: { lat: 32.0605, lng: 34.7748 } },
  { id: 'carmel', name: 'הכרמל / הרצל', position: { lat: 32.0622, lng: 34.7674 } },
  { id: 'gruzenberg', name: 'נחלת בנימין / גרוזנברג', position: { lat: 32.0634, lng: 34.7714 } },
  { id: 'allenby_herzl', name: 'אלנבי / הרצל', position: { lat: 32.0639, lng: 34.7671 } },
  { id: 'yehuda_allenby', name: 'יהודה הלוי / אלנבי', position: { lat: 32.0633, lng: 34.7757 } },
  { id: 'allenby_nahalat', name: 'אלנבי / נחלת בנימין', position: { lat: 32.0650, lng: 34.7714 } },
]

/**
 * Undirected edges. `context` is the static street character used by the
 * street_context signal; it is a property of the road, never of the people
 * on it (spec section Het).
 */
const EDGES: EdgeSpec[] = [
  // --- Florentin interior -------------------------------------------------
  { from: 'flo_herzl', to: 'flo_vital', name: 'רחוב פלורנטין', context: 'secondary_street' },
  { from: 'flo_herzl', to: 'flo_melacha', name: 'רחוב פלורנטין', context: 'secondary_street' },
  { from: 'flo_vital', to: 'vital_levinsky', name: 'רחוב ויטל', context: 'alley' },
  { from: 'flo_herzl', to: 'herzl_levinsky', name: 'רחוב הרצל', context: 'main_street' },
  { from: 'flo_melacha', to: 'nahalat_levinsky', name: 'רחוב המלאכה', context: 'alley' },
  { from: 'flo_melacha', to: 'melacha_yehuda', name: 'רחוב המלאכה', context: 'secondary_street' },

  // --- Levinsky cross-street ---------------------------------------------
  { from: 'vital_levinsky', to: 'herzl_levinsky', name: 'רחוב לוינסקי', context: 'secondary_street' },
  { from: 'herzl_levinsky', to: 'nahalat_levinsky', name: 'רחוב לוינסקי', context: 'secondary_street' },

  // --- Herzl corridor (main street, north-south) --------------------------
  { from: 'herzl_levinsky', to: 'herzl_mid', name: 'רחוב הרצל', context: 'main_street' },
  { from: 'herzl_mid', to: 'carmel', name: 'רחוב הרצל', context: 'main_street' },
  { from: 'carmel', to: 'allenby_herzl', name: 'רחוב הרצל', context: 'main_street' },
  { from: 'vital_levinsky', to: 'herzl_mid', name: 'סמטת הגדוד העברי', context: 'isolated_passage' },

  // --- Nahalat Binyamin corridor (quiet after hours) ----------------------
  { from: 'nahalat_levinsky', to: 'nahalat_mid', name: 'נחלת בנימין', context: 'residential' },
  { from: 'nahalat_mid', to: 'gruzenberg', name: 'נחלת בנימין', context: 'residential' },
  { from: 'gruzenberg', to: 'allenby_nahalat', name: 'נחלת בנימין', context: 'secondary_street' },

  // --- Yehuda Halevi corridor (long way round) ----------------------------
  { from: 'melacha_yehuda', to: 'yehuda_mid', name: 'יהודה הלוי', context: 'main_street' },
  { from: 'yehuda_mid', to: 'yehuda_allenby', name: 'יהודה הלוי', context: 'main_street' },
  { from: 'nahalat_levinsky', to: 'yehuda_mid', name: 'רחוב הרכבת', context: 'secondary_street' },

  // --- Allenby cross-street ----------------------------------------------
  { from: 'allenby_herzl', to: 'allenby_nahalat', name: 'שדרות אלנבי', context: 'main_street' },
  { from: 'yehuda_allenby', to: 'allenby_nahalat', name: 'שדרות אלנבי', context: 'main_street' },
]

function segmentId(from: string, to: string): string {
  // Stable regardless of traversal direction, so features attach to the
  // street itself rather than to a direction of travel.
  return [from, to].sort().join('__')
}

function buildSegments(): Map<string, StreetSegment> {
  const byId = new Map<string, StreetSegment>()
  const nodeById = new Map(NODES.map((n) => [n.id, n]))

  for (const edge of EDGES) {
    const a = nodeById.get(edge.from)
    const b = nodeById.get(edge.to)
    if (!a || !b) throw new Error(`graph edge references unknown node: ${edge.from}-${edge.to}`)

    const id = segmentId(edge.from, edge.to)
    if (byId.has(id)) throw new Error(`duplicate graph edge: ${id}`)

    byId.set(id, {
      id,
      name: edge.name,
      from: edge.from,
      to: edge.to,
      geometry: [a.position, b.position],
      context: edge.context,
      lengthM: haversineM(a.position, b.position),
    })
  }
  return byId
}

export const SEGMENTS: Map<string, StreetSegment> = buildSegments()

export interface AdjacencyEntry {
  toNode: string
  segmentId: string
}

function buildAdjacency(): Map<string, AdjacencyEntry[]> {
  const adj = new Map<string, AdjacencyEntry[]>()
  for (const node of NODES) adj.set(node.id, [])
  for (const seg of SEGMENTS.values()) {
    adj.get(seg.from)!.push({ toNode: seg.to, segmentId: seg.id })
    adj.get(seg.to)!.push({ toNode: seg.from, segmentId: seg.id })
  }
  return adj
}

export const ADJACENCY: Map<string, AdjacencyEntry[]> = buildAdjacency()

export function getSegment(id: string): StreetSegment {
  const seg = SEGMENTS.get(id)
  if (!seg) throw new Error(`unknown segment: ${id}`)
  return seg
}

export function getNode(id: string): GraphNode {
  const node = NODES.find((n) => n.id === id)
  if (!node) throw new Error(`unknown node: ${id}`)
  return node
}

/** Nearest graph node to an arbitrary coordinate - the graph's geocoder. */
export function nearestNode(position: LatLng): GraphNode {
  let best = NODES[0]!
  let bestDist = haversineM(position, best.position)
  for (const node of NODES.slice(1)) {
    const d = haversineM(position, node.position)
    if (d < bestDist) {
      best = node
      bestDist = d
    }
  }
  return best
}

/** Named places offered by destination search on screen S01. */
export const PLACES: { id: string; label: string; nodeId: string }[] = NODES.map((n) => ({
  id: n.id,
  label: n.name,
  nodeId: n.id,
}))
