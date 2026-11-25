// הסורק: תוצאה גדולה למעלה שאפשר לקרוא ממטר, מצלמה שממשיכה לסרוק לבד, וכפתורים למטה.
import React, { useEffect, useRef, useState } from "react";

import { AppState, Linking, Pressable, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useKeepAwake } from "expo-keep-awake";
import type { EventSummary } from "../api";
import { UNDO_MS, type Door } from "../useDoor";
import { Button, Check, Counter, Cross, Header, NoSignal } from "../ui";
import { C, F, row, rtl } from "../theme";

const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

export default function Scanner({ door, event, staffName, onBack, onSearch, onStats }: { door: Door; event: EventSummary; staffName: string; onBack: () => void; onSearch: () => void; onStats: () => void }) {
  useKeepAwake(); // המסך לא נכבה באמצע ערב
  const [perm, ask] = useCameraPermissions();
  const [typing, setTyping] = useState(false);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const typed = useRef("");
  const lastSent = useRef("");
  const [now, setNow] = useState(Date.now());
  const [active, setActive] = useState(true);
  const last = useRef({ data: "", at: 0 });
  const { shown, stats, online, pending, syncedAt } = door;

  useEffect(() => {
    if (perm && !perm.granted && perm.canAskAgain) ask();
  }, [perm, ask]);
  // המצלמה נעצרת כשהאפליקציה ברקע, וחוזרת כשחוזרים
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const onScan = ({ data }: { data: string }) => {
    const t = Date.now();
    // אותו קוד לא נבדק שוב תוך 3 שניות: המצלמה רואה אותו כמה פעמים בשנייה
    if (data === last.current.data && t - last.current.at < 3000) return;
    last.current = { data, at: t };
    door.check(data);
  };

  const undoLeft = shown.kind === "ok" && online && shown.ticket ? UNDO_MS - (now - shown.at) : 0;
  const idle = shown.kind === "idle";
  const quiet = idle || shown.neutral; // מוכן לסריקה, או כניסה שבוטלה: בלי צבע של החלטה
  const panelBg = quiet ? C.card : shown.good ? C.acid : C.red;
  const fg = quiet ? C.paper : C.ink;
  // הקוד נלקח מהאירוע עצמו ולא מה-state, כי סורק חיצוני מקליד ושולח בבת אחת
  const submit = (text?: string) => {
    const full = (text ?? typed.current).trim();
    // רשת ביטחון: אם השדה עוד החזיק את מה שנשלח קודם, הקוד החדש נדבק אחריו. מורידים את מה שכבר נשלח
    const prev = lastSent.current;
    const v = prev && full.length > prev.length && full.startsWith(prev) ? full.slice(prev.length) : full;
    lastSent.current = full;
    typed.current = "";
    input.current?.clear();
    // ב-iOS ניקוי בתוך אירוע השליחה לא תמיד נשמר, ולכן מנקים שוב מיד אחריו.
    // אחרת הקוד הבא מתחבר לקודם, וזה בדיוק מה שקורה עם סורק חיצוני
    setTimeout(() => {
      if (!typed.current.trim() || typed.current.trim() === v || typed.current.trim().endsWith(v)) {
        input.current?.clear();
        typed.current = "";
      }
    }, 0);
    if (v) door.check(v);
  };

  return (
    <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 14 }}>
      <Header title={event.artist} sub={`${event.title}${staffName ? ` · ${staffName}` : ""}`} onBack={onBack} backLabel="כל ההופעות" right={<Counter inside={stats.inside} total={stats.total} />} />

      {!online || pending ? (
        <View style={[row, { gap: 12, backgroundColor: C.paper, borderRadius: 16, padding: 12 }]} accessibilityLiveRegion="polite">
          {!online ? <NoSignal /> : null}
          <View style={{ flex: 1 }}>
            <Text style={[rtl, { fontFamily: F.bodyBold, fontSize: 16, color: C.ink }]}>{online ? "שולחים כניסות שנסרקו בלי קליטה" : "אין חיבור לשרת. ממשיכים לסרוק."}</Text>
            <Text style={[rtl, { fontFamily: F.body, fontSize: 14, color: C.ink }]}>{syncedAt ? `הרשימה נשמרה במכשיר ב-${syncedAt}` : "בודקים מול הרשימה שבמכשיר"}</Text>
          </View>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 14, backgroundColor: C.ink, color: C.paper, borderRadius: 999, overflow: "hidden", paddingVertical: 6, paddingHorizontal: 10 }}>{pending} בתור</Text>
        </View>
      ) : null}

      <View style={{ backgroundColor: panelBg, borderRadius: 26, paddingVertical: 24, paddingHorizontal: 22, gap: 6 }} accessibilityLiveRegion="assertive" accessibilityRole="summary">
        <View style={[row, { gap: 12 }]}>
          {quiet ? null : shown.good ? <Check /> : <Cross />}
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[rtl, { fontFamily: F.display, fontSize: idle ? 30 : 40, lineHeight: idle ? 36 : 46, color: fg, flexShrink: 1 }]}>{shown.title}</Text>
        </View>
        {shown.name ? <Text style={[rtl, { fontFamily: F.title, fontSize: 24, color: fg }]}>{shown.name}</Text> : null}
        {shown.detail ? <Text style={[rtl, { fontFamily: F.body, fontSize: 17, color: quiet ? C.muted : C.ink }]}>{shown.detail}</Text> : null}
        {undoLeft > 0 ? (
          <Pressable onPress={door.undo} accessibilityRole="button" style={({ pressed }) => ({ marginTop: 10, alignSelf: "flex-end", minHeight: 44, justifyContent: "center", paddingHorizontal: 16, borderRadius: 12, borderWidth: 1.5, borderColor: C.ink, opacity: pressed ? 0.6 : 1 })}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.ink }}>ביטול הכניסה (עוד {mmss(undoLeft)})</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={{ flex: 1, minHeight: 160, borderRadius: 26, overflow: "hidden", backgroundColor: C.camera, alignItems: "center", justifyContent: "center" }}>
        {perm?.granted ? (
          <>
            <CameraView style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0 }} facing="back" active={active} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={onScan} />
            <View pointerEvents="none" style={{ width: 200, height: 200, borderRadius: 24, borderWidth: 3, borderColor: quiet || shown.good ? C.acid : C.red, borderStyle: online ? "solid" : "dashed" }} />
            <Text style={{ position: "absolute", bottom: 12, fontFamily: F.body, fontSize: 14, color: C.paper }}>ממשיכים לסרוק אוטומטית</Text>
          </>
        ) : (
          <View style={{ padding: 20, gap: 12, alignItems: "center" }}>
            <Text style={{ fontFamily: F.body, fontSize: 16, color: C.muted, textAlign: "center" }}>אין גישה למצלמה. אפשר להקליד קוד או לחפש לפי שם.</Text>
            <Button kind="raised" label={perm?.canAskAgain === false ? "פתיחת ההגדרות" : "אישור מצלמה"} onPress={() => (perm?.canAskAgain === false ? Linking.openSettings() : ask())} />
          </View>
        )}
      </View>

      {typing ? (
        <View key="typing" style={[row, { gap: 10 }]}>
          <TextInput
            ref={input}
            autoFocus
            onChangeText={(t) => (typed.current = t)}
            submitBehavior="submit"
            placeholder="קוד כרטיס"
            placeholderTextColor={C.faint}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="קוד כרטיס"
            returnKeyType="go"
            onSubmitEditing={(e) => submit(e.nativeEvent.text)}
            style={{ flex: 1, height: 56, borderRadius: 16, backgroundColor: C.card, borderWidth: 2, borderColor: C.acid, color: C.paper, fontFamily: F.bodyBold, fontSize: 20, letterSpacing: 1, paddingHorizontal: 14, textAlign: "left" }}
          />
          <Button label="בדיקה" onPress={() => submit()} />
          <Button kind="raised" label="סגירה" onPress={() => setTyping(false)} />
        </View>
      ) : (
        <View key="actions" style={[row, { gap: 10 }]}>
          <Button kind="raised" label="חיפוש שם" onPress={onSearch} style={{ flex: 1 }} />
          <Button kind="raised" label="הקלדת קוד" onPress={() => setTyping(true)} style={{ flex: 1 }} />
          <Button kind="raised" label="מצב" onPress={onStats} style={{ flex: 1 }} />
        </View>
      )}
    </View>
  );
}
