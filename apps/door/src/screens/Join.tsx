// הצטרפות: סורקים את ה-QR של הקישור מהמארגן, או מדביקים את הקישור. בלי סיסמה.
import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { ApiError, call, parseJoin, type Home, type Session } from "../api";
import { Brand, Button, QrGlyph } from "../ui";
import { C, F, rtl } from "../theme";

export default function Join({ onJoined }: { onJoined: (s: Session, home: Home) => void }) {
  const [mode, setMode] = useState<"intro" | "scan" | "paste">("intro");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [perm, ask] = useCameraPermissions();
  const tried = useRef("");

  async function tryJoin(input: string) {
    if (busy || tried.current === input) return;
    tried.current = input;
    const s = parseJoin(input);
    if (!s) {
      setError("זה לא קישור צוות של JoCares. הקישור נראה כך: jocares.../door/s/...");
      setTimeout(() => (tried.current = ""), 2500);
      return;
    }
    setBusy(true);
    setError("");
    try {
      onJoined(s, await call<Home>(s, "/me"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "אין חיבור לשרת. בדקו קליטה ונסו שוב.");
      tried.current = "";
    } finally {
      setBusy(false);
    }
  }

  async function startScan() {
    setError("");
    if (!perm?.granted) {
      const r = await ask();
      if (!r.granted) return setError("בלי גישה למצלמה אפשר להדביק את הקישור במקום.");
    }
    setMode("scan");
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, paddingHorizontal: 28, paddingTop: 24, paddingBottom: 24, gap: 24 }}>
      <View style={{ alignItems: "flex-end" }}><Brand size={22} /></View>

      <View style={{ flex: 1, justifyContent: "center", gap: 18 }}>
        {mode === "scan" ? (
          <View style={{ height: 300, borderRadius: 26, overflow: "hidden", backgroundColor: C.camera }}>
            <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={({ data }) => tryJoin(data)} />
          </View>
        ) : (
          <View style={{ width: 220, height: 220, alignSelf: "center", borderWidth: 2, borderColor: C.line, borderRadius: 28, alignItems: "center", justifyContent: "center" }}>
            <QrGlyph />
          </View>
        )}
        <Text style={[rtl, { fontFamily: F.display, fontSize: 34, lineHeight: 38, color: C.paper }]} accessibilityRole="header">
          {"סורקים כרטיסים.\nבלי לחכות בתור."}
        </Text>
        <Text style={[rtl, { fontFamily: F.body, fontSize: 18, lineHeight: 27, color: C.muted }]}>
          {mode === "scan" ? "כוונו את המצלמה ל-QR של קישור הצוות שהמארגן שלח." : "המארגן שלח לכם קישור אישי לצוות הכניסה. סרקו את ה-QR שלו, או הדביקו את הקישור."}
        </Text>
        {mode === "paste" ? (
          <TextInput
            value={link}
            onChangeText={setLink}
            placeholder="https://.../door/s/..."
            placeholderTextColor={C.faint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            accessibilityLabel="קישור הצוות"
            onSubmitEditing={() => tryJoin(link)}
            style={{ height: 58, borderRadius: 16, borderWidth: 2, borderColor: C.acid, backgroundColor: C.card, color: C.paper, fontFamily: F.mono, fontSize: 16, paddingHorizontal: 16, textAlign: "left" }}
          />
        ) : null}
        {error ? <Text style={[rtl, { fontFamily: F.bodyBold, fontSize: 16, color: C.red }]} accessibilityLiveRegion="polite">{error}</Text> : null}
      </View>

      <View style={{ gap: 12 }}>
        {mode === "paste" ? (
          <Button label={busy ? "מתחברים..." : "התחברות"} disabled={busy || !link} onPress={() => tryJoin(link)} />
        ) : (
          <Button label={mode === "scan" ? "סורקים..." : "סריקת קוד הצטרפות"} disabled={mode === "scan"} onPress={startScan} />
        )}
        <Button kind="ghost" label={mode === "paste" ? "סריקה במקום" : "הדבקת קישור"} onPress={() => (setError(""), setMode(mode === "paste" ? "intro" : "paste"))} />
        <Text style={{ fontFamily: F.body, fontSize: 14, color: C.faint, textAlign: "center", marginTop: 4 }}>אין צורך בסיסמה. המארגן יכול לבטל את הגישה בכל רגע.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}
