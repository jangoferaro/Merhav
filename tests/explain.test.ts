import { describe, expect, it } from 'vitest'
import { findViolations } from '../shared/guardrails.ts'
import { renderTemplate } from '../server/explain/template.ts'
import { validateExplanation } from '../server/explain/validate.ts'
import type { ExplanationPayload } from '../server/explain/payload.ts'
import { PROHIBITED_CLAIMS } from '../shared/guardrails.ts'

function payload(over: Partial<ExplanationPayload> = {}): ExplanationPayload {
  return {
    recommended_route: 'r2',
    recommended_via: 'רחוב הרצל',
    alternative_route: 'r1',
    alternative_via: 'נחלת בנימין',
    extra_time_minutes: 3,
    positives: ['human_activity', 'open_places', 'main_street'],
    alternative_negatives: ['low_activity'],
    confidence: 'medium',
    prohibited_claims: PROHIBITED_CLAIMS,
    permitted_numbers: [3],
    ...over,
  }
}

describe('guardrails', () => {
  it('catches absolute safety and danger claims in Hebrew', () => {
    // The exact forbidden sentences from spec section Yod-Tet.
    expect(findViolations('המסלול בטוח.')).not.toHaveLength(0)
    expect(findViolations('לא יקרה לך שם כלום.')).not.toHaveLength(0)
    expect(findViolations('הרחוב השני מסוכן.')).not.toHaveLength(0)
    expect(findViolations('אין סיכון בדרך הזאת.')).not.toHaveLength(0)
  })

  it('catches the same claims in English', () => {
    expect(findViolations('This route is safe.')).not.toHaveLength(0)
    expect(findViolations('Guaranteed to avoid trouble.')).not.toHaveLength(0)
  })

  it('catches language that describes or ranks people', () => {
    expect(findViolations('יש שם אנשים חשודים')).not.toHaveLength(0)
    expect(findViolations('זו שכונה מסוכנת')).not.toHaveLength(0)
    expect(findViolations('it is a bad neighbourhood')).not.toHaveLength(0)
  })

  it('permits the relative phrasing the spec allows', () => {
    expect(
      findViolations('לפי המידע הזמין כרגע אנחנו ממליצים על המסלול הזה.'),
    ).toHaveLength(0)
    expect(findViolations('המסלול פעיל יותר בשעה הזו לפי הנתונים שיש לנו.')).toHaveLength(0)
  })
})

describe('renderTemplate', () => {
  it('names the recommended street and the extra time', () => {
    const text = renderTemplate(payload())
    expect(text).toContain('רחוב הרצל')
    expect(text).toContain('3')
  })

  it('never produces a forbidden claim, whatever the payload', () => {
    // Exhaustive over the vocabulary: the template can only emit approved
    // clauses, so this holds by construction - assert it stays that way.
    const codes = [
      'main_street', 'open_places', 'active_transit', 'well_lit', 'human_activity',
      'shorter_route', 'low_activity', 'poor_lighting', 'isolated_segment',
      'park_at_night', 'recent_report', 'sparse_data', 'negligible_difference',
    ] as const
    for (const code of codes) {
      for (const confidence of ['high', 'medium', 'low'] as const) {
        const text = renderTemplate(
          payload({ positives: [code], alternative_negatives: [code], confidence }),
        )
        expect(findViolations(text), `${code}/${confidence}: ${text}`).toHaveLength(0)
      }
    }
  })

  it('says low confidence out loud', () => {
    expect(renderTemplate(payload({ confidence: 'low' }))).toMatch(/חלקי/)
  })

  it('prefers the faster route when the difference is negligible', () => {
    const text = renderTemplate(
      payload({ positives: ['negligible_difference'], extra_time_minutes: 0 }),
    )
    expect(text).toMatch(/אין הבדל משמעותי/)
  })

  it('stays within the two-to-four lines the spec asks for', () => {
    const text = renderTemplate(
      payload({
        positives: ['human_activity', 'open_places', 'main_street', 'well_lit', 'active_transit'],
        alternative_negatives: ['low_activity', 'poor_lighting', 'isolated_segment'],
        confidence: 'low',
      }),
    )
    expect(text.length).toBeLessThanOrEqual(420)
  })

  it('always passes its own validator', () => {
    const p = payload()
    expect(validateExplanation(renderTemplate(p), p).ok).toBe(true)
  })
})

describe('validateExplanation', () => {
  it('rejects a draft containing a forbidden claim', () => {
    const result = validateExplanation('המסלול הזה בטוח לחלוטין.', payload())
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/prohibited_claim/)
  })

  it('rejects a draft that invents a number', () => {
    // FR-05: the explanation must not add facts absent from the payload.
    // "7 open businesses" is the classic hallucination this catches.
    const result = validateExplanation(
      'עדיף ללכת דרך הרצל, זה מוסיף 3 דקות ויש שם 7 עסקים פתוחים.',
      payload(),
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/invented_number:7/)
  })

  it('accepts numbers that are in the payload', () => {
    expect(validateExplanation('זה מוסיף בערך 3 דקות.', payload()).ok).toBe(true)
  })

  it('rejects an over-long draft', () => {
    const result = validateExplanation('א'.repeat(500), payload())
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/too_long/)
  })

  it('rejects an empty draft', () => {
    expect(validateExplanation('   ', payload()).reason).toBe('empty_output')
  })
})
