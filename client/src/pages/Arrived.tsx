/**
 * S06 - Arrived.
 *
 * Spec section Heh, step 11: one optional question, plus the option to report.
 * The screen also states plainly that the session's location data is gone,
 * because a privacy promise the user cannot see is not worth much.
 */

interface ArrivedProps {
  onFeedback: (useful: boolean) => void
  feedbackGiven: boolean
  onReport: () => void
  onDone: () => void
}

export function Arrived({ onFeedback, feedbackGiven, onReport, onDone }: ArrivedProps) {
  return (
    <div className="stack">
      <h1>הגעת.</h1>

      <div className="card">
        {feedbackGiven ? (
          <p className="muted">תודה. זה עוזר לכייל את ההמלצות.</p>
        ) : (
          <>
            <h3>ההמלצה הייתה שימושית?</h3>
            <div className="btn-row">
              <button className="btn" onClick={() => onFeedback(true)}>
                כן
              </button>
              <button className="btn" onClick={() => onFeedback(false)}>
                לא ממש
              </button>
            </div>
          </>
        )}
      </div>

      <button className="btn btn--ghost" onClick={onReport}>
        לדווח על משהו בדרך
      </button>

      <p className="faint">
        נתוני המיקום של ההליכה הזאת נמחקו. לא נשמרה היסטוריית מסלול במכשיר ולא בשרת.
      </p>

      <button className="btn btn--primary" onClick={onDone}>
        סיום
      </button>
    </div>
  )
}
