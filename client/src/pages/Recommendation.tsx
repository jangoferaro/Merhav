/**
 * S02 - Route recommendation, with S03 ("why this route?") as a sheet.
 *
 * Spec section Vav, default behaviour: show ONE recommended route
 * prominently, with a faster alternative beneath it if one exists. No raw
 * numeric score - relative labels only.
 */

import { useState } from 'react'
import type { EvaluateResponse, ScoredRoute } from '@shared/types.ts'
import { MapView } from '../components/MapView.tsx'
import { RouteCard } from '../components/RouteCard.tsx'
import { ReasonList } from '../components/ReasonList.tsx'
import { CONFIDENCE_LABEL, formatDuration, minutes } from '../lib/format.ts'

interface RecommendationProps {
  evaluation: EvaluateResponse
  selectedRouteId: string
  onSelectRoute: (routeId: string) => void
  onStartWalk: () => void
  onBack: () => void
  starting: boolean
}

export function Recommendation({
  evaluation,
  selectedRouteId,
  onSelectRoute,
  onStartWalk,
  onBack,
  starting,
}: RecommendationProps) {
  const [showWhy, setShowWhy] = useState(false)
  const { routes, recommendation, explanation } = evaluation

  const selected = routes.find((r) => r.id === selectedRouteId) ?? routes[0]!
  const fastest = routes.find((r) => r.id === recommendation.fastestRouteId) ?? routes[0]!
  const confidenceNote = CONFIDENCE_LABEL[recommendation.confidence]

  // Recommended first, then the fastest, then the rest.
  const ordered: ScoredRoute[] = [
    ...routes.filter((r) => r.id === recommendation.recommendedRouteId),
    ...routes.filter(
      (r) => r.id !== recommendation.recommendedRouteId && r.id === recommendation.fastestRouteId,
    ),
    ...routes.filter(
      (r) => r.id !== recommendation.recommendedRouteId && r.id !== recommendation.fastestRouteId,
    ),
  ]

  return (
    <>
      <MapView
        routes={routes}
        recommendedRouteId={recommendation.recommendedRouteId}
        selectedRouteId={selected.id}
        position={null}
      />

      <div className="stack">
        <div className="explanation">
          <p>{explanation.text}</p>
          <p className="explanation__source">
            {explanation.source === 'template'
              ? 'הסבר נוצר מהסיבות שהמנוע חישב'
              : 'הסבר נוסח על בסיס הסיבות שהמנוע חישב'}
            {confidenceNote ? ` · ${confidenceNote}` : ''}
          </p>
        </div>

        <button className="btn btn--ghost" onClick={() => setShowWhy(true)}>
          למה המסלול הזה?
        </button>

        {ordered.map((route) => (
          <RouteCard
            key={route.id}
            route={route}
            recommendation={recommendation}
            fastestDurationS={fastest.durationS}
            selected={route.id === selected.id}
            onSelect={() => onSelectRoute(route.id)}
          />
        ))}

        <button className="btn btn--primary" onClick={onStartWalk} disabled={starting}>
          {starting ? 'מתחיל…' : `להתחיל ללכת · ${formatDuration(selected.durationS)}`}
        </button>
        <button className="btn btn--ghost" onClick={onBack}>
          לשנות יעד
        </button>
      </div>

      {showWhy && (
        <div className="sheet-backdrop" onClick={() => setShowWhy(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-label="למה המסלול הזה"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sheet__head">
              <h2>למה המסלול הזה?</h2>
              <button className="btn btn--ghost" onClick={() => setShowWhy(false)}>
                סגירה
              </button>
            </div>

            <p className="muted">
              {recommendation.extraTimeS > 0
                ? `המסלול המומלץ מוסיף ${minutes(recommendation.extraTimeS)} דק׳ על הדרך המהירה.`
                : 'המסלול המומלץ הוא גם המהיר ביותר.'}
            </p>

            <h3>מה תומך בהמלצה</h3>
            <ReasonList codes={recommendation.positives} />

            {recommendation.alternativeNegatives.length > 0 && (
              <>
                <h3>מה פחות מתאים בחלופה</h3>
                <ReasonList codes={recommendation.alternativeNegatives} />
              </>
            )}

            <h3>עדכניות ואמינות</h3>
            <p className="muted">
              {confidenceNote ? `${confidenceNote}.` : 'המידע על המסלול הזה מלא יחסית.'}
              {selected.weakestSegment
                ? ` המקטע החלש ביותר במסלול הוא ${selected.weakestSegment.name}.`
                : ''}
            </p>

            {/*
              Spec section Yod-Tet's permitted phrasing, verbatim in spirit:
              relative, sourced, and never a promise.
            */}
            <p className="faint">
              SAFE WALK ממליץ על הדרך העדיפה לפי המידע הזמין כרגע. זו אינה הבטחה, ואינה תחליף
              לשיקול דעת שלך או לפנייה לגורמי חירום.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
