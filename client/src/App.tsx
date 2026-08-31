/**
 * SAFE WALK - application shell.
 *
 * Mirrors the session state machine in spec section Yod-Alef:
 *   IDLE -> ROUTE_SELECTED -> WALKING -> (OFF_ROUTE | RECOMPUTE) -> ARRIVED
 *
 * The rule this component exists to keep: the client never decides anything.
 * It shows what /v1/routes/evaluate returned, and asks the server again when
 * something changes. There is no scoring, no route ranking and no explanation
 * text on this side of the wire.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  EvaluateResponse,
  LatLng,
  ReevaluateResult,
  ReportCategory,
  SafetyPreferences,
} from '@shared/types.ts'
import { api, ApiError, type Place } from './lib/api.ts'
import { clearStoredData, loadPreferences, savePreferences } from './lib/prefs.ts'
import { Home } from './pages/Home.tsx'
import { Recommendation } from './pages/Recommendation.tsx'
import { Walking } from './pages/Walking.tsx'
import { Arrived } from './pages/Arrived.tsx'
import { ReportSheet } from './pages/ReportSheet.tsx'
import { Preferences } from './pages/Preferences.tsx'

type Screen = 'home' | 'recommendation' | 'walking' | 'arrived'

/** Fallback origin when location is unavailable: the spec's own scenario. */
const FALLBACK_ORIGIN: Place = {
  id: 'flo_herzl',
  name: 'פלורנטין / הרצל',
  position: { lat: 32.0562, lng: 34.7688 },
}

export function App() {
  const [screen, setScreen] = useState<Screen>('home')
  const [preferences, setPreferences] = useState<SafetyPreferences>(() => loadPreferences())
  const [showPreferences, setShowPreferences] = useState(false)
  const [showReport, setShowReport] = useState(false)

  const [origin, setOrigin] = useState<Place | null>(null)
  const [destination, setDestination] = useState<Place | null>(null)
  const [locating, setLocating] = useState(false)
  const [locationError, setLocationError] = useState<string | null>(null)

  const [evaluation, setEvaluation] = useState<EvaluateResponse | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [walkId, setWalkId] = useState<string | null>(null)
  const [activeRouteId, setActiveRouteId] = useState<string>('')
  const [position, setPosition] = useState<LatLng | null>(null)
  const [progressM, setProgressM] = useState(0)
  const [remainingM, setRemainingM] = useState(0)
  const [offRoute, setOffRoute] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const [change, setChange] = useState<ReevaluateResult | null>(null)
  const [starting, setStarting] = useState(false)

  const [recents, setRecents] = useState<Place[]>([])
  const [reportSubmitting, setReportSubmitting] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)
  const [feedbackGiven, setFeedbackGiven] = useState(false)

  useEffect(() => {
    savePreferences(preferences)
  }, [preferences])

  const originLabel = origin ? origin.name : 'לא נבחרה נקודת מוצא'

  const useDeviceLocation = useCallback(() => {
    setLocationError(null)
    if (!('geolocation' in navigator)) {
      setOrigin(FALLBACK_ORIGIN)
      setLocationError('אין גישה למיקום בדפדפן הזה. נבחרה נקודת מוצא לדוגמה.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (result) => {
        setOrigin({
          id: 'device',
          name: 'המיקום הנוכחי שלי',
          position: { lat: result.coords.latitude, lng: result.coords.longitude },
        })
        setLocating(false)
      },
      () => {
        // Refusing location must not break the product - section Heh step 1
        // allows choosing A by hand.
        setOrigin(FALLBACK_ORIGIN)
        setLocationError('לא התקבלה הרשאת מיקום. אפשר לבחור נקודת מוצא ידנית.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }, [])

  const runEvaluation = useCallback(
    async (from: Place, to: Place, prefs: SafetyPreferences) => {
      setLoading(true)
      setError(null)
      try {
        const result = await api.evaluate({
          origin: from.position,
          destination: to.position,
          preferences: prefs,
        })
        setEvaluation(result)
        setSelectedRouteId(result.recommendation.recommendedRouteId)
        setScreen('recommendation')
      } catch (cause) {
        const message =
          cause instanceof ApiError && cause.code === 'NO_ROUTE'
            ? 'לא נמצא מסלול הליכה בין שתי הנקודות האלה.'
            : cause instanceof ApiError
              ? cause.message
              : 'לא הצלחנו לחשב מסלול כרגע.'
        setError(message)
        setScreen('home')
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const handleDestination = useCallback(
    (place: Place) => {
      if (!origin) return
      setDestination(place)
      setRecents((current) => [place, ...current.filter((p) => p.id !== place.id)].slice(0, 4))
      void runEvaluation(origin, place, preferences)
    },
    [origin, preferences, runEvaluation],
  )

  // Changing preferences mid-recommendation re-asks the server rather than
  // re-ranking locally - the decision policy lives in one place.
  useEffect(() => {
    if (screen === 'recommendation' && origin && destination) {
      void runEvaluation(origin, destination, preferences)
    }
    // Intentionally keyed on preferences only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences])

  const startWalk = useCallback(async () => {
    if (!origin || !destination || !evaluation) return
    setStarting(true)
    setError(null)
    try {
      const session = await api.startWalk({
        origin: origin.position,
        destination: destination.position,
        routeId: selectedRouteId,
        preferences,
      })
      setWalkId(session.id)
      setActiveRouteId(selectedRouteId)
      const route = evaluation.routes.find((r) => r.id === selectedRouteId)!
      setRemainingM(route.distanceM)
      setProgressM(0)
      setStepIndex(0)
      setPosition(route.geometry[0] ?? null)
      setChange(null)
      setScreen('walking')
    } catch {
      setError('לא הצלחנו להתחיל ניווט כרגע.')
    } finally {
      setStarting(false)
    }
  }, [destination, evaluation, origin, preferences, selectedRouteId])

  /**
   * Advances along the route.
   *
   * In a shipped app this is the geolocation watch; in Phase 0 it steps
   * through the route's own vertices so the whole live-navigation path -
   * position updates, off-route detection, re-evaluation, the S05 banner - can
   * be exercised on a laptop.
   */
  const step = useCallback(async () => {
    if (!walkId || !evaluation) return
    const route = evaluation.routes.find((r) => r.id === activeRouteId)
    if (!route) return

    const next = Math.min(stepIndex + 1, route.geometry.length - 1)
    const point = route.geometry[next]!
    setStepIndex(next)

    try {
      const update = await api.updateLocation(walkId, point)
      setPosition(point)
      setProgressM(update.session.progressM)
      setRemainingM(update.remainingM)
      setOffRoute(update.offRoute)

      const result = await api.reevaluate(walkId)
      setChange(result.changed ? result : null)
    } catch {
      setError('אבד החיבור לשרת. הניווט ממשיך עם המסלול הנוכחי.')
    }
  }, [activeRouteId, evaluation, stepIndex, walkId])

  const acceptChange = useCallback(async () => {
    if (!walkId || !change?.alternative) return
    try {
      await api.acceptRoute(walkId, change.alternative.routeId)
      setActiveRouteId(change.alternative.routeId)
      setStepIndex(0)
      setChange(null)
    } catch {
      setError('לא הצלחנו להחליף מסלול כרגע.')
    }
  }, [change, walkId])

  const finishWalk = useCallback(
    async (cancelled: boolean) => {
      if (walkId) {
        try {
          await api.arrive(walkId, cancelled)
        } catch {
          /* ending a session must never block the user */
        }
      }
      setWalkId(null)
      setPosition(null)
      setChange(null)
      setOffRoute(false)
      setScreen(cancelled ? 'recommendation' : 'arrived')
    },
    [walkId],
  )

  const submitReport = useCallback(
    async (category: ReportCategory, note: string) => {
      const where = position ?? origin?.position
      if (!where) return
      setReportSubmitting(true)
      setReportError(null)
      try {
        await api.report({ category, position: where, ...(note ? { note } : {}) })
        setShowReport(false)
      } catch (cause) {
        setReportError(cause instanceof ApiError ? cause.message : 'הדיווח לא נשלח.')
      } finally {
        setReportSubmitting(false)
      }
    },
    [origin, position],
  )

  const resetAll = useCallback(() => {
    clearStoredData()
    setRecents([])
    setEvaluation(null)
    setDestination(null)
    setShowPreferences(false)
    setScreen('home')
  }, [])

  const body = useMemo(() => {
    if (loading) {
      return (
        <div className="stack">
          <div className="card" style={{ justifyItems: 'center' }}>
            <div className="spinner" aria-label="מחשב מסלולים" />
            <p className="muted">בודקים חלופות ומדרגים אותן…</p>
          </div>
        </div>
      )
    }

    if (screen === 'recommendation' && evaluation) {
      return (
        <Recommendation
          evaluation={evaluation}
          selectedRouteId={selectedRouteId}
          onSelectRoute={setSelectedRouteId}
          onStartWalk={startWalk}
          onBack={() => setScreen('home')}
          starting={starting}
        />
      )
    }

    if (screen === 'walking' && evaluation) {
      return (
        <Walking
          evaluation={evaluation}
          activeRouteId={activeRouteId}
          position={position}
          progressM={progressM}
          remainingM={remainingM}
          offRoute={offRoute}
          change={change}
          onAcceptChange={acceptChange}
          onKeepCurrent={() => setChange(null)}
          onSimulateStep={step}
          onReport={() => setShowReport(true)}
          onArrive={() => void finishWalk(false)}
          onStop={() => void finishWalk(true)}
        />
      )
    }

    if (screen === 'arrived') {
      return (
        <Arrived
          feedbackGiven={feedbackGiven}
          onFeedback={() => setFeedbackGiven(true)}
          onReport={() => setShowReport(true)}
          onDone={() => {
            setFeedbackGiven(false)
            setScreen('home')
          }}
        />
      )
    }

    return (
      <Home
        origin={origin?.position ?? null}
        originLabel={originLabel}
        onPickOrigin={setOrigin}
        onUseDeviceLocation={useDeviceLocation}
        locating={locating}
        locationError={locationError}
        onSubmit={handleDestination}
        recents={recents}
        onOpenPreferences={() => setShowPreferences(true)}
      />
    )
  }, [
    acceptChange, activeRouteId, change, evaluation, feedbackGiven, finishWalk,
    handleDestination, loading, locating, locationError, offRoute, origin,
    originLabel, position, progressM, recents, remainingM, screen,
    selectedRouteId, starting, startWalk, step, useDeviceLocation,
  ])

  return (
    <div className="app">
      <header className="app__header">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <span>SAFE WALK</span>
        </div>
        <button className="btn btn--ghost" onClick={() => setShowPreferences(true)}>
          העדפות
        </button>
      </header>

      <div className="app__body">
        {error && (
          <div className="stack" style={{ paddingBottom: 0 }}>
            <p className="error">{error}</p>
          </div>
        )}
        {body}
        {screen === 'home' && (
          <p className="disclaimer">
            SAFE WALK משווה חלופות וממליץ על הדרך העדיפה לפי המידע הזמין. הוא אינו מבטיח דבר על
            מה שיקרה בדרך, ואינו תחליף לשיקול דעת שלך או לפנייה לגורמי חירום.
          </p>
        )}
      </div>

      {showReport && (
        <ReportSheet
          onSubmit={(category, note) => void submitReport(category, note)}
          onClose={() => setShowReport(false)}
          submitting={reportSubmitting}
          error={reportError}
        />
      )}

      {showPreferences && (
        <Preferences
          preferences={preferences}
          onChange={setPreferences}
          onClose={() => setShowPreferences(false)}
          onClearData={resetAll}
        />
      )}
    </div>
  )
}
