// המפתח האישי נשמר בכספת של המכשיר. רשימת הכרטיסים ותור הכניסות נשמרים באחסון הרגיל.
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getRandomBytes } from "expo-crypto";
import type { Session } from "./api";

const SESSION = "jocares.door.session";

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
export const saveSession = (s: Session) => SecureStore.setItemAsync(SESSION, JSON.stringify(s));

/** התנתקות: מוחקים את המפתח וכל מה שנשמר על הכרטיסים */
export async function clearAll() {
  await SecureStore.deleteItemAsync(SESSION);
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith("door:"));
  await AsyncStorage.multiRemove(keys);
}

export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(`door:${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export const setJSON = (key: string, value: unknown) => AsyncStorage.setItem(`door:${key}`, JSON.stringify(value)).catch(() => {});

/** מזהה קבוע למכשיר, כדי שהמארגן יראה מאיזו דלת נכנסו */
export async function deviceId(): Promise<string> {
  let d = await getJSON<string>("device", "");
  if (!d) {
    d = Array.from(getRandomBytes(5), (b) => b.toString(16).padStart(2, "0")).join("");
    await setJSON("device", d);
  }
  return d;
}
