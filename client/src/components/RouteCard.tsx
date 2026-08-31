import type { Recommendation, ScoredRoute } from '@shared/types.ts'
import { formatDistance, formatDuration, minutes, relativeLabel } from '../lib/format.ts'
import { REASON_SPECS } from '@shared/reasonCodes.ts'

interface RouteCardProps {
  route: ScoredRoute
  recommendation: Recommendation
  /** Duration of the fastest alternative, so "how much extra" is unambiguous. */
  fastestDurationS: number
  selected: boolean
  onSelect: () => void
}

export function RouteCard({
  route,
  recommendation,
  fastestDurationS,
  selected,
  onSelect,
}: RouteCardProps) {
  const isRecommended = route.id === recommendation.recommendedRouteId
  const isFastest = route.id === recommendation.fastestRouteId
  const extraMinutes = minutes(route.durationS) - minutes(fastestDurationS)

  return (
    <button type="button" className="card route-card" aria-pressed={selected} onClick={onSelect}>
      <div className="route-card__head">
        <span className="route-card__time">{formatDuration(route.durationS)}</span>
        <span
          className={`badge ${
            isRecommended ? 'badge--recommended' : isFastest ? 'badge--fastest' : 'badge--info'
          }`}
        >
          {relativeLabel(isRecommended, isFastest)}
        </span>
      </div>

      <p className="muted">
        {formatDistance(route.distanceM)}
        {extraMinutes > 0 ? ` · ${extraMinutes} דק׳ יותר מהמהיר` : ''}
      </p>

      {/*
        Relative labels rather than a raw score, per spec section Vav: "there is
        no need to show a raw numeric score to the user." The number stays in
        the API for calibration and debugging.
      */}
      <div className="chip-row">
        {route.reasonCodes.slice(0, 3).map((code) => (
          <span key={code} className="chip">
            {REASON_SPECS[code].label}
          </span>
        ))}
      </div>
    </button>
  )
}
