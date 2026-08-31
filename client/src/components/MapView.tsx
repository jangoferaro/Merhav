/**
 * Leaflet map showing the alternatives.
 *
 * Colour carries meaning here, so it is never the only carrier: every route is
 * also labelled in the cards below, and the "why" panel states each factor in
 * words. Spec section Tet-Vav: "a full verbal explanation - do not rely on map
 * colours alone."
 */

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { LatLng, ScoredRoute } from '@shared/types.ts'

interface MapViewProps {
  routes: ScoredRoute[]
  recommendedRouteId: string | null
  selectedRouteId: string | null
  position: LatLng | null
  tall?: boolean
}

const RECOMMENDED = '#f0b429'
const ALTERNATIVE = '#6ba8d8'
const MUTED = '#4d5b6d'

export function MapView({
  routes,
  recommendedRouteId,
  selectedRouteId,
  position,
  tall = false,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layersRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      zoomControl: false,
      attributionControl: true,
    }).setView([32.06, 34.771], 15)

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
    }).addTo(map)

    mapRef.current = map
    layersRef.current = L.layerGroup().addTo(map)

    return () => {
      map.remove()
      mapRef.current = null
      layersRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layers = layersRef.current
    if (!map || !layers) return
    layers.clearLayers()
    if (routes.length === 0) return

    // Draw non-selected routes first so the chosen one sits on top.
    const ordered = [...routes].sort((a, b) => {
      const rank = (r: ScoredRoute) => (r.id === selectedRouteId ? 2 : r.id === recommendedRouteId ? 1 : 0)
      return rank(a) - rank(b)
    })

    for (const route of ordered) {
      const isSelected = route.id === selectedRouteId
      const isRecommended = route.id === recommendedRouteId
      L.polyline(
        route.geometry.map((p) => [p.lat, p.lng] as [number, number]),
        {
          color: isRecommended ? RECOMMENDED : isSelected ? ALTERNATIVE : MUTED,
          weight: isSelected ? 6 : isRecommended ? 5 : 3,
          opacity: isSelected || isRecommended ? 0.95 : 0.45,
          lineCap: 'round',
          lineJoin: 'round',
        },
      ).addTo(layers)
    }

    const first = routes[0]
    if (first && first.geometry.length > 0) {
      const start = first.geometry[0]!
      const end = first.geometry[first.geometry.length - 1]!
      L.circleMarker([start.lat, start.lng], {
        radius: 6, color: '#e8edf4', fillColor: '#10151c', fillOpacity: 1, weight: 2,
      }).addTo(layers).bindTooltip('נקודת מוצא')
      L.circleMarker([end.lat, end.lng], {
        radius: 7, color: RECOMMENDED, fillColor: RECOMMENDED, fillOpacity: 1, weight: 2,
      }).addTo(layers).bindTooltip('יעד')
    }

    if (position) {
      L.circleMarker([position.lat, position.lng], {
        radius: 8, color: '#ffffff', fillColor: ALTERNATIVE, fillOpacity: 1, weight: 3,
      }).addTo(layers).bindTooltip('כאן')
    }

    const bounds = L.latLngBounds(
      routes.flatMap((r) => r.geometry.map((p) => [p.lat, p.lng] as [number, number])),
    )
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [34, 34] })
  }, [routes, recommendedRouteId, selectedRouteId, position])

  return (
    <div
      ref={containerRef}
      className={tall ? 'map map--tall' : 'map'}
      role="img"
      aria-label={
        routes.length === 0
          ? 'מפה'
          : `מפה עם ${routes.length} מסלולי הליכה. הפירוט המלא מופיע בכרטיסים שמתחת למפה.`
      }
    />
  )
}
