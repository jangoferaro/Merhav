// איזו הופעה: ההופעות של המארגן מאתמול ועד שבוע קדימה.
import React, { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { call, type EventSummary, type Home, type Session } from "../api";
import { Bar, Brand, Button } from "../ui";
import { C, F, row, rtl } from "../theme";

const when = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const mins = (d.getTime() - now.getTime()) / 60000;
  if (mins < 60 && mins > -360) return "עכשיו";
  if (d.toDateString() === now.toDateString()) return "הערב";
  return d.toLocaleDateString("he-IL", { weekday: "long" });
};
const hour = (iso: string) => new Date(iso).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });

export default function Events({ session, home, onHome, onPick, onLogout }: { session: Session; home: Home; onHome: (h: Home) => void; onPick: (e: EventSummary) => void; onLogout: () => void }) {
  const [refreshing, setRefreshing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try { onHome(await call<Home>(session, "/me")); } catch {}
    setRefreshing(false);
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 22, flexGrow: 1 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.acid} />}>
      <View style={[row, { justifyContent: "space-between" }]}>
        <Brand />
        <Pressable onPress={() => setConfirming(true)} accessibilityRole="button" accessibilityLabel="התנתקות" hitSlop={10}>
          <Text style={{ fontFamily: F.body, fontSize: 15, color: C.muted }}>{home.staff.name} · {home.organizer.name}</Text>
        </Pressable>
      </View>
      {confirming ? (
        <View style={{ backgroundColor: C.card, borderRadius: 20, padding: 18, gap: 12, borderWidth: 1.5, borderColor: C.line }} accessibilityLiveRegion="polite">
          <Text style={[rtl, { fontFamily: F.display, fontSize: 20, color: C.paper }]}>להתנתק מהמכשיר?</Text>
          <Text style={[rtl, { fontFamily: F.body, fontSize: 16, lineHeight: 23, color: C.muted }]}>המפתח האישי והרשימות יימחקו מהמכשיר. כדי לחזור צריך שוב את הקישור מהמארגן.</Text>
          <View style={[row, { gap: 10 }]}>
            <Button kind="raised" label="התנתקות" onPress={onLogout} style={{ flex: 1 }} />
            <Button kind="ghost" label="ביטול" onPress={() => setConfirming(false)} style={{ flex: 1 }} />
          </View>
        </View>
      ) : null}
      <Text style={[rtl, { fontFamily: F.display, fontSize: 32, color: C.paper }]} accessibilityRole="header">איזו הופעה?</Text>
      <View style={{ gap: 12 }}>
        {home.events.map((e) => {
          const label = when(e.starts_at);
          // כשהמארגן הוא האמן עצמו, השם זהה בכל הכרטיסים: אז הכותרת היא שם ההופעה
          const same = e.artist === home.organizer.name;
          const head = same ? e.title : e.artist;
          const sub = same ? `${hour(e.starts_at)} · ${e.venue}` : `${e.title} · ${hour(e.starts_at)} · ${e.venue}`;
          const live = label === "עכשיו";
          return (
            <Pressable
              key={e.id}
              onPress={() => onPick(e)}
              accessibilityRole="button"
              accessibilityLabel={`${e.artist}, ${e.title}, ${label} ${hour(e.starts_at)}, ${e.inside} נכנסו מתוך ${e.total}`}
              style={({ pressed }) => ({ backgroundColor: live ? "#1F1F1D" : C.card, borderWidth: 1.5, borderColor: live ? C.acid : "#2E2E2B", borderRadius: 20, padding: 18, gap: 6, opacity: pressed ? 0.8 : 1 })}
            >
              <View style={[row, { justifyContent: "space-between", gap: 8 }]}>
                <Text style={[rtl, { fontFamily: F.display, fontSize: 21, color: C.paper, flex: 1 }]} numberOfLines={1}>{head}</Text>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999, overflow: "hidden", backgroundColor: live ? C.acid : "#2E2E2B", color: live ? C.ink : C.paper }}>{label}</Text>
              </View>
              <Text style={[rtl, { fontFamily: F.body, fontSize: 16, color: C.muted }]} numberOfLines={1}>{sub}</Text>
              <View style={[row, { gap: 10, marginTop: 8 }]}>
                <View style={{ flex: 1 }}><Bar value={e.total ? e.inside / e.total : 0} /></View>
                <Text style={{ fontFamily: F.mono, fontSize: 15, color: C.paper }}>{e.inside} / {e.total}</Text>
              </View>
            </Pressable>
          );
        })}
        {!home.events.length ? <Text style={[rtl, { fontFamily: F.body, fontSize: 18, color: C.muted }]}>אין הופעות היום או בשבוע הקרוב.</Text> : null}
      </View>
      <Text style={{ marginTop: "auto", fontFamily: F.body, fontSize: 14, color: C.faint, textAlign: "center" }}>מוצגות הופעות מאתמול ועד שבוע קדימה. משיכה למטה לרענון.</Text>
    </ScrollView>
  );
}
