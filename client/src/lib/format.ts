import type { ConfidenceBand } from '@shared/types.ts'

export function minutes(seconds: number): number {
  return Math.max(0, Math.round(seconds / 60))
}

export function formatDuration(seconds: number): string {
  const m = minutes(seconds)
  if (m < 60) return `${m} דק׳`
  return `${Math.floor(m / 60)} שע׳ ${m % 60} דק׳`
}

export function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} מ׳` : `${(metres / 1000).toFixed(1)} ק״מ`
}

/**
 * Spec section Yod-Gimel: high confidence needs no label at all when
 * everything is normal - only say something when there is something to say.
 */
export const CONFIDENCE_LABEL: Record<ConfidenceBand, string | null> = {
  high: null,
  medium: 'מבוסס על מידע חלקי',
  low: 'מידע חלקי — העדפה קלה בלבד',
}

/**
 * Spec section Vav: prefer relative labels over a raw numeric score.
 * The number exists in the API for debugging and calibration; the interface
 * shows a word.
 */
export function relativeLabel(isRecommended: boolean, isFastest: boolean): string {
  if (isRecommended) return 'מומלץ'
  if (isFastest) return 'הכי מהיר'
  return 'חלופה'
}
