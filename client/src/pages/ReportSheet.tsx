/**
 * S07 - Report.
 *
 * Short categories plus optional free text (spec section Vav). No photo in
 * Phase 0: the spec lists "does a report include a photo in the MVP, or only
 * text/category?" as an open question, and shipping image upload before that
 * is answered would create a moderation and privacy surface nobody has scoped.
 *
 * The category list deliberately includes "all good here" - a reporting tool
 * that only accepts bad news produces a map that only shows bad news.
 */

import { useState } from 'react'
import type { ReportCategory } from '@shared/types.ts'

const CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: 'poor_lighting', label: 'תאורה לקויה' },
  { value: 'blocked_passage', label: 'מעבר חסום' },
  { value: 'feels_deserted', label: 'המקום מרגיש נטוש' },
  { value: 'disturbance', label: 'הפרעה או אירוע חריג' },
  { value: 'visible_emergency_response', label: 'כוחות חירום במקום' },
  { value: 'all_good', label: 'הכול בסדר כאן' },
]

interface ReportSheetProps {
  onSubmit: (category: ReportCategory, note: string) => void
  onClose: () => void
  submitting: boolean
  error: string | null
}

export function ReportSheet({ onSubmit, onClose, submitting, error }: ReportSheetProps) {
  const [category, setCategory] = useState<ReportCategory | null>(null)
  const [note, setNote] = useState('')

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label="דיווח"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet__head">
          <h2>מה קורה כאן?</h2>
          <button className="btn btn--ghost" onClick={onClose}>
            סגירה
          </button>
        </div>

        <div className="chip-row">
          {CATEGORIES.map((option) => (
            <button
              key={option.value}
              className="chip"
              aria-pressed={category === option.value}
              onClick={() => setCategory(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="field">
          <label htmlFor="note">להוסיף פרט (לא חובה)</label>
          <input
            id="note"
            value={note}
            maxLength={280}
            onChange={(event) => setNote(event.target.value)}
            placeholder="למשל: הפנס בפינה כבוי"
          />
        </div>

        {/*
          Spec section Yod-Bet, abuse prevention: no naming or photographing
          people as "suspects". Stated in the interface, not only enforced in
          moderation after the fact.
        */}
        <p className="faint">
          מדווחים על המקום, לא על אנשים. דיווח שמתאר אדם מסוים לא יתקבל.
        </p>

        {error && <p className="error">{error}</p>}

        <button
          className="btn btn--primary"
          disabled={category === null || submitting}
          onClick={() => category && onSubmit(category, note.trim())}
        >
          {submitting ? 'שולח…' : 'לשלוח דיווח'}
        </button>
      </div>
    </div>
  )
}
