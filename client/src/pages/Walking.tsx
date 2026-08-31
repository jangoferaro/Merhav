/**
 * S04 - Walk with SAFE, with S05 (route changed) as an inline banner.
 *
 * Spec section Yod-Alef asks for calm messaging - "there is a better option in
 * about seventy metres", not an alert - and for the user to stay in control:
 * Accept / Keep current / Stop guidance are all one tap away, and nothing
 * changes route on its own.
 */

import type { EvaluateResponse, LatLng, ReevaluateResult } from '@shared/types.ts'
import { MapView } from '../components/MapView.tsx'
import { formatDistance, formatDuration, minutes } from '../lib/format.ts'

interface WalkingProps {
  evaluation: EvaluateResponse
  activeRouteId: string
  position: LatLng | null
  progressM: number
  remainingM: number
  offRoute: boolean
  change: ReevaluateResult | null
  onAcceptChange: () => void
  onKeepCurrent: () => void
  onSimulateStep: () => void
  onReport: () => void
  onArrive: () => void
  onStop: () => void
}

export function Walking({
  evaluation,
  activeRouteId,
  position,
  progressM,
  remainingM,
  offRoute,
  change,
  onAcceptChange,
  onKeepCurrent,
  onSimulateStep,
  onReport,
  onArrive,
  onStop,
}: WalkingProps) {
  const route = evaluation.routes.find((r) => r.id === activeRouteId) ?? evaluation.routes[0]!
  const progressPercent = route.distanceM === 0 ? 0 : Math.min(100, (progressM / route.distanceM) * 100)
  const etaS = Math.round((remainingM / route.distanceM) * route.durationS) || 0

  return (
    <>
      <MapView
        routes={evaluation.routes.filter(
          (r) => r.id === activeRouteId || r.id === change?.alternative?.routeId,
        )}
        recommendedRouteId={activeRouteId}
        selectedRouteId={change?.alternative?.routeId ?? activeRouteId}
        position={position}
        tall
      />

      <div className="stack">
        <div className="card">
          <div className="route-card__head">
            <span className="route-card__time">{formatDuration(etaS)}</span>
            <span className="badge badge--info">{formatDistance(remainingM)} נותרו</span>
          </div>
          <div className="progress" role="progressbar" aria-valuenow={Math.round(progressPercent)} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress__bar" style={{ width: `${progressPercent}%` }} />
          </div>
          {offRoute && (
            <p className="muted">
              נראה שירדת מהמסלול. אפשר להמשיך — המערכת תחשב מחדש כשתמשיך ללכת.
            </p>
          )}
        </div>

        {/*
          S05. Calm and specific: what changed, how much time it adds, and two
          equally weighted buttons. "Keep current" is never the small one.
        */}
        {change?.changed && change.alternative && (
          <div className="banner" role="status">
            <p>{change.message}</p>
            <p className="muted">{change.alternative.explanation.text}</p>
            <div className="btn-row">
              <button className="btn btn--primary" onClick={onAcceptChange}>
                לעבור למסלול · +{minutes(change.alternative.extraTimeS)} דק׳
              </button>
              <button className="btn" onClick={onKeepCurrent}>
                להישאר במסלול
              </button>
            </div>
          </div>
        )}

        <div className="btn-row">
          <button className="btn" onClick={onReport}>
            לדווח
          </button>
          <button className="btn" onClick={onSimulateStep}>
            להתקדם (הדגמה)
          </button>
        </div>

        <button className="btn btn--primary" onClick={onArrive}>
          הגעתי
        </button>
        <button className="btn btn--ghost" onClick={onStop}>
          לעצור ניווט
        </button>
      </div>
    </>
  )
}
