// רכיבים משותפים: כותרת, כפתורים, אייקונים. כפתורים בגובה 56 לפחות, כי עובדים ביד אחת ובחושך.
import React from "react";
import { Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";
import { C, F, row, rtl } from "./theme";

export function Brand({ size = 20 }: { size?: number }) {
  return (
    <Text style={{ fontFamily: F.brand, fontSize: size, color: C.paper }} accessibilityLabel="JoCares Door">
      JoCares<Text style={{ color: C.acid }}>.</Text> Door
    </Text>
  );
}

type BtnProps = PressableProps & { label: string; kind?: "acid" | "ghost" | "raised" | "danger"; style?: StyleProp<ViewStyle> };
export function Button({ label, kind = "acid", style, ...p }: BtnProps) {
  const bg = kind === "acid" ? C.acid : kind === "danger" ? C.red : kind === "raised" ? C.raised : "transparent";
  const fg = kind === "acid" || kind === "danger" ? C.ink : C.paper;
  return (
    <Pressable
      accessibilityRole="button"
      {...p}
      style={({ pressed }) => [s.btn, { backgroundColor: bg, borderWidth: kind === "ghost" ? 1.5 : 0, opacity: pressed ? 0.75 : p.disabled ? 0.5 : 1 }, style]}
    >
      <Text style={[s.btnText, { color: fg, fontFamily: kind === "acid" || kind === "danger" ? F.display : F.bodyBold }]}>{label}</Text>
    </Pressable>
  );
}

export function BackButton({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={({ pressed }) => [s.back, { opacity: pressed ? 0.7 : 1 }]}>
      <Svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={C.paper} strokeWidth={2}>
        <Path d="M9 6l6 6-6 6" />
      </Svg>
    </Pressable>
  );
}

export function Header({ title, sub, onBack, backLabel = "חזרה", right }: { title: string; sub?: string; onBack?: () => void; backLabel?: string; right?: React.ReactNode }) {
  return (
    <View style={[row, { gap: 12 }]}>
      {onBack ? <BackButton onPress={onBack} label={backLabel} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[rtl, { fontFamily: F.display, fontSize: 18, color: C.paper }]} numberOfLines={1}>{title}</Text>
        {sub ? <Text style={[rtl, { fontFamily: F.body, fontSize: 14, color: C.muted }]} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export const Check = ({ size = 44, color = C.ink }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.6}><Path d="M4 12.5l5 5L20 6.5" /></Svg>
);
export const Cross = ({ size = 44, color = C.ink }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.6}><Path d="M6 6l12 12M18 6L6 18" /></Svg>
);
export const QrGlyph = ({ size = 120, color = C.acid }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.4}>
    <Path d="M3 7V4h3M21 7V4h-3M3 17v3h3M21 17v3h-3" />
    <Rect x={7} y={7} width={4} height={4} /><Rect x={13} y={7} width={4} height={4} /><Rect x={7} y={13} width={4} height={4} />
    <Path d="M13 13h2v2h-2zM15 15h2v2h-2z" />
  </Svg>
);
export const NoSignal = ({ size = 26, color = C.ink }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2}>
    <Path d="M3 3l18 18M8.5 16.5a5 5 0 017 0M5 12.6a10 10 0 014.2-2.4M19 12.6a10 10 0 00-2.4-1.6M12 20h.01" />
  </Svg>
);

export function Counter({ inside, total, big = 22 }: { inside: number; total: number; big?: number }) {
  return (
    <Text style={{ fontFamily: F.mono, fontSize: 15, color: C.paper }} accessibilityLabel={`${inside} נכנסו מתוך ${total}`}>
      <Text style={{ fontSize: big, color: C.acid }}>{inside}</Text> / {total}
    </Text>
  );
}

export function Bar({ value, height = 6 }: { value: number; height?: number }) {
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: "#2B2B28", overflow: "hidden", flexDirection: "row-reverse" }}>
      <View style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, backgroundColor: C.acid }} />
    </View>
  );
}

const s = StyleSheet.create({
  btn: { minHeight: 56, borderRadius: 16, borderColor: C.line, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  btnText: { fontSize: 18 },
  back: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.raised, alignItems: "center", justifyContent: "center" },
});
