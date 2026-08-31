/**
 * S01 - "Where are we going?"
 *
 * Current location, destination field, recent destinations, settings.
 * The location permission is requested in context with a stated reason
 * (spec section Yod-Tet), and choosing A by hand is always available so the
 * product is usable without granting it at all.
 */

import { useEffect, useState } from 'react'
import type { LatLng } from '@shared/types.ts'
import { api, type Place } from '../lib/api.ts'

interface HomeProps {
  origin: LatLng | null
  originLabel: string
  onPickOrigin: (place: Place) => void
  onUseDeviceLocation: () => void
  locating: boolean
  locationError: string | null
  onSubmit: (destination: Place) => void
  recents: Place[]
  onOpenPreferences: () => void
}

export function Home({
  origin,
  originLabel,
  onPickOrigin,
  onUseDeviceLocation,
  locating,
  locationError,
  onSubmit,
  recents,
  onOpenPreferences,
}: HomeProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [pickingOrigin, setPickingOrigin] = useState(false)

  useEffect(() => {
    let cancelled = false
    const handle = setTimeout(() => {
      api
        .places(query)
        .then((body) => {
          if (!cancelled) setResults(body.places)
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [query])

  return (
    <div className="stack">
      <h1>לאן הולכים?</h1>

      <div className="card">
        <h3>נקודת מוצא</h3>
        <p>{originLabel}</p>
        <div className="btn-row">
          <button className="btn" onClick={onUseDeviceLocation} disabled={locating}>
            {locating ? 'מאתר…' : 'המיקום שלי'}
          </button>
          <button className="btn" onClick={() => setPickingOrigin((v) => !v)}>
            {pickingOrigin ? 'ביטול' : 'לבחור ידנית'}
          </button>
        </div>
        {/*
          Spec section Yod-Tet: show the rationale for a permission request.
          Stated up front rather than after the OS dialog appears.
        */}
        <p className="faint">
          המיקום משמש רק לחישוב המסלול ולניווט במהלך ההליכה. אפשר גם לבחור נקודת מוצא ידנית.
        </p>
        {locationError && <p className="error">{locationError}</p>}
      </div>

      <div className="field">
        <label htmlFor="destination">{pickingOrigin ? 'לבחור נקודת מוצא' : 'יעד'}</label>
        <input
          id="destination"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="שם רחוב או צומת"
          autoComplete="off"
        />
      </div>

      {results.length > 0 && (
        <div className="stack" style={{ padding: 0, gap: 8 }}>
          {results.map((place) => (
            <button
              key={place.id}
              className="btn btn--ghost"
              style={{ textAlign: 'start' }}
              onClick={() => {
                if (pickingOrigin) {
                  onPickOrigin(place)
                  setPickingOrigin(false)
                  setQuery('')
                } else {
                  onSubmit(place)
                }
              }}
              disabled={!pickingOrigin && origin === null}
            >
              {place.name}
            </button>
          ))}
        </div>
      )}

      {recents.length > 0 && !pickingOrigin && (
        <div className="card">
          <h3>יעדים אחרונים</h3>
          <div className="chip-row">
            {recents.map((place) => (
              <button
                key={place.id}
                className="chip"
                onClick={() => onSubmit(place)}
                disabled={origin === null}
              >
                {place.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <button className="btn btn--ghost" onClick={onOpenPreferences}>
        העדפות הליכה
      </button>
    </div>
  )
}
