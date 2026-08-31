/**
 * S08 - Safety preferences (spec section Tet-Vav).
 *
 * These feed straight into the decision policy: `maxDetourMinutes` is a hard
 * ceiling in the detour gate, and the rest move the PreferenceMatch term of
 * the utility function. So the settings are real controls over the
 * recommendation, not cosmetic toggles.
 */

import type { DetourTolerance, PreferenceLevel, SafetyPreferences } from '@shared/types.ts'

const DETOURS: { value: DetourTolerance; label: string }[] = [
  { value: 3, label: 'עד 3 דק׳' },
  { value: 5, label: 'עד 5 דק׳' },
  { value: 10, label: 'עד 10 דק׳' },
  { value: 'auto', label: 'אוטומטי' },
]

const LEVELS: { value: PreferenceLevel; label: string }[] = [
  { value: 'low', label: 'נמוכה' },
  { value: 'normal', label: 'רגילה' },
  { value: 'high', label: 'גבוהה' },
]

interface PreferencesProps {
  preferences: SafetyPreferences
  onChange: (preferences: SafetyPreferences) => void
  onClose: () => void
  onClearData: () => void
}

export function Preferences({ preferences, onChange, onClose, onClearData }: PreferencesProps) {
  const set = <K extends keyof SafetyPreferences>(key: K, value: SafetyPreferences[K]) =>
    onChange({ ...preferences, [key]: value })

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="העדפות הליכה"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet__head">
          <h2>העדפות הליכה</h2>
          <button className="btn btn--ghost" onClick={onClose}>
            סגירה
          </button>
        </div>

        <div>
          <h3>עיקוף מקסימלי</h3>
          <div className="chip-row">
            {DETOURS.map((option) => (
              <button
                key={String(option.value)}
                className="chip"
                aria-pressed={preferences.maxDetourMinutes === option.value}
                onClick={() => set('maxDetourMinutes', option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3>העדפת רחובות ראשיים</h3>
          <div className="chip-row">
            {LEVELS.map((option) => (
              <button
                key={option.value}
                className="chip"
                aria-pressed={preferences.preferMainStreets === option.value}
                onClick={() => set('preferMainStreets', option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3>העדפת מקומות פתוחים</h3>
          <div className="chip-row">
            {LEVELS.map((option) => (
              <button
                key={option.value}
                className="chip"
                aria-pressed={preferences.preferOpenPlaces === option.value}
                onClick={() => set('preferOpenPlaces', option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3>העדפת נתיבים מוארים</h3>
          <div className="chip-row">
            {LEVELS.map((option) => (
              <button
                key={option.value}
                className="chip"
                aria-pressed={preferences.preferLitRoutes === option.value}
                onClick={() => set('preferLitRoutes', option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <h3>פארקים בשעות הלילה</h3>
          <div className="chip-row">
            <button
              className="chip"
              aria-pressed={!preferences.avoidParksAtNight}
              onClick={() => set('avoidParksAtNight', false)}
            >
              רגיל
            </button>
            <button
              className="chip"
              aria-pressed={preferences.avoidParksAtNight}
              onClick={() => set('avoidParksAtNight', true)}
            >
              להעדיף להימנע
            </button>
          </div>
        </div>

        <div>
          <h3>פרטיות</h3>
          <p className="faint">
            ההעדפות נשמרות במכשיר בלבד. SAFE WALK אינו שומר היסטוריית מסלולים, ומיקום ההליכה
            נמחק ברגע שהיא מסתיימת.
          </p>
          <button className="btn" onClick={onClearData}>
            למחוק את הנתונים מהמכשיר
          </button>
        </div>
      </div>
    </div>
  )
}
