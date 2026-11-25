// משוב בלי להסתכל על המסך: צליל גבוה ורטט קצר לכניסה, צליל נמוך ורטט כפול לדחייה.
import * as Haptics from "expo-haptics";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

let ok: AudioPlayer | null = null;
let bad: AudioPlayer | null = null;

export async function initFeedback() {
  try {
    // הצליל נשמע גם כשהטלפון על שקט: בדלת אין זמן לבדוק את המתג
    await setAudioModeAsync({ playsInSilentMode: true });
    ok = createAudioPlayer(require("../assets/sounds/ok.wav"));
    bad = createAudioPlayer(require("../assets/sounds/bad.wav"));
  } catch {}
}

export function feedback(good: boolean) {
  try {
    const p = good ? ok : bad;
    p?.seekTo(0);
    p?.play();
  } catch {}
  Haptics.notificationAsync(good ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error).catch(() => {});
}
