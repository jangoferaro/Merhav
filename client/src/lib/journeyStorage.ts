import {
  CONVERSATION_STORAGE_KEY,
  EMPTY_MEMORY,
  EMPTY_PROFILE,
  JOURNEY_STORAGE_KEY,
  NEW_SESSION_GAP_MS,
  PROFILE_STORAGE_KEY,
  isValidAge,
  isValidName,
  type Gender,
  type Profile,
  type JourneyState,
} from "@shared/merhav";

/**
 * ניהול האחסון המקומי של המסע. מופרד מההוק כדי שיהיה אפשר
 * לבדוק אותו בלי לרנדר קומפוננטות.
 */

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export function readJourney(storage: StorageLike | null): JourneyState {
  const now = Date.now();
  const fallback: JourneyState = {
    memory: { ...EMPTY_MEMORY },
    sessionCount: 0,
    lastVisitAt: 0,
    startedAt: now,
  };

  if (!storage) return fallback;

  try {
    const raw = storage.getItem(JOURNEY_STORAGE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<JourneyState>;
    if (!parsed || typeof parsed !== "object") return fallback;

    return {
      memory: { ...EMPTY_MEMORY, ...(parsed.memory || {}) },
      sessionCount:
        typeof parsed.sessionCount === "number" ? parsed.sessionCount : 0,
      lastVisitAt:
        typeof parsed.lastVisitAt === "number" ? parsed.lastVisitAt : 0,
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : now,
    };
  } catch {
    return fallback;
  }
}

/** האם החזרה הזאת נחשבת מפגש חדש */
export function isNewSession(lastVisitAt: number, now = Date.now()): boolean {
  return lastVisitAt > 0 && now - lastVisitAt > NEW_SESSION_GAP_MS;
}

/** מוחק הכול — גם את השיחה וגם את הזיכרון */
export function clearJourney(storage: StorageLike | null): void {
  if (!storage) return;
  try {
    storage.removeItem(CONVERSATION_STORAGE_KEY);
    storage.removeItem(JOURNEY_STORAGE_KEY);
    storage.removeItem(PROFILE_STORAGE_KEY);
  } catch {
    // אחסון חסום
  }
}

const GENDERS: Gender[] = ["male", "female", "other"];

export function readProfile(storage: StorageLike | null): Profile {
  if (!storage) return { ...EMPTY_PROFILE };

  try {
    const raw = storage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return { ...EMPTY_PROFILE };

    const parsed = JSON.parse(raw) as Partial<Profile>;
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_PROFILE };

    const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
    const age = typeof parsed.age === "number" ? Math.floor(parsed.age) : 0;
    const gender =
      typeof parsed.gender === "string" &&
      GENDERS.includes(parsed.gender as Gender)
        ? (parsed.gender as Gender)
        : "";

    return {
      name: isValidName(name) ? name : "",
      age: isValidAge(age) ? age : 0,
      gender,
      completed: parsed.completed === true,
    };
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

export function writeProfile(
  storage: StorageLike | null,
  profile: Profile
): void {
  if (!storage) return;
  try {
    storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // אחסון חסום
  }
}
