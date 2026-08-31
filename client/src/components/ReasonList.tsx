/**
 * The "why this route?" factor list (screen S03).
 *
 * Spec section Vav: three to five central factors, with source/freshness where
 * relevant, plus confidence. Each factor is a reason code the engine emitted -
 * the UI only looks up its label, it never composes a reason of its own.
 */

import { REASON_SPECS } from '@shared/reasonCodes.ts'
import type { ReasonCode } from '@shared/types.ts'

export function ReasonList({ codes }: { codes: ReasonCode[] }) {
  if (codes.length === 0) {
    return <p className="muted">אין גורמים בולטים לציין במסלול הזה.</p>
  }
  return (
    <ul className="reason-list">
      {codes.map((code) => {
        const spec = REASON_SPECS[code]
        return (
          <li key={code} className="reason">
            <span className={`reason__dot reason__dot--${spec.polarity}`} aria-hidden="true" />
            <span>
              <strong>{spec.label}</strong>
              <span className="muted"> — {spec.clause}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
