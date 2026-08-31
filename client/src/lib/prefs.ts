/**
 * Safety preferences, persisted on the device (spec section Tet-Vav).
 *
 * Kept in localStorage rather than on the server: preferences are not needed
 * anywhere else, and not collecting them is the cheapest privacy measure
 * available (spec section Yod-Tet).
 */

import type { SafetyPreferences } from '@shared/types.ts'
import { DEFAULT_PREFERENCES } from '@shared/types.ts'

const KEY = 'safewalk.preferences.v1'

export function loadPreferences(): SafetyPreferences {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_PREFERENCES
    return { ...DEFAULT_PREFERENCES, ...(JSON.parse(raw) as Partial<SafetyPreferences>) }
  } catch {
    // A private window, cleared site data, or storage disabled entirely.
    return DEFAULT_PREFERENCES
  }
}

export function savePreferences(preferences: SafetyPreferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(preferences))
  } catch {
    // Non-fatal: the session still works, the choice just is not remembered.
  }
}

export function clearStoredData(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to clear */
  }
}
