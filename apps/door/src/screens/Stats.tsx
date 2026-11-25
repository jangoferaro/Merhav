// מצב הדלת: מספרים בלבד. פרטי הקונים נשארים אצל המארגן.
import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { call, type Session } from "../api";
import type { Door } from "../useDoor";
import { Bar, Header } from "../ui";
import { C, F, row, rtl } from "../theme";

export default function Stats({ door, session, campaignId, artist, onBack }: { door: Door; session: Session; campaignId: number; artist: string; onBack: () => void }) {
  const [staff, setStaff] = useState<{ name: string; n: number }[]>([]);
  useEffect(() => {
    const load = () => call<{ staff: { name: string; n: number }[] }>(session, `/e/${campaignId}/stats`).then((r) => setStaff(r.staff)).catch(() => {});
    load();
    door.refresh();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [session, campaignId]);

  const { inside, total, last15 } = door.stats;
  const tiles = [
    { n: last15, label: "ב-15 הדקות האחרונות" },
    { n: Math.max(0, total - inside), label: "עוד לא הגיעו" },
    { n: door.rejected, label: "נדחו במכשיר הזה" },
    { n: door.pending, label: "ממתינות לשליחה" },
  ];
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 16 }}>
      <Header title="מצב הדלת" sub={`${artist} · ${door.online ? "מתעדכן בזמן אמת" : "בלי קליטה"}`} onBack={onBack} backLabel="חזרה לסריקה" />
      <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 22, gap: 12 }} accessible accessibilityLabel={`${inside} בפנים מתוך ${total}`}>
        <Text style={[rtl, { fontFamily: F.body, fontSize: 15, color: C.muted }]}>בפנים</Text>
        <Text style={[rtl, { fontFamily: F.brand, fontSize: 64, lineHeight: 70, color: C.paper }]}>
          {inside}<Text style={{ fontSize: 28, color: C.faint }}> / {total}</Text>
        </Text>
        <Bar value={total ? inside / total : 0} height={10} />
      </View>
      <View style={[row, { flexWrap: "wrap", gap: 10 }]}>
        {tiles.map((t) => (
          <View key={t.label} style={{ width: "48%", flexGrow: 1, backgroundColor: C.card, borderRadius: 20, padding: 16, gap: 4 }}>
            <Text style={[rtl, { fontFamily: F.brand, fontSize: 30, color: C.paper }]}>{t.n}</Text>
            <Text style={[rtl, { fontFamily: F.body, fontSize: 14, color: C.muted }]}>{t.label}</Text>
          </View>
        ))}
      </View>
      <View style={{ backgroundColor: C.card, borderRadius: 20, padding: 16, gap: 10 }}>
        <Text style={[rtl, { fontFamily: F.bodyBold, fontSize: 15, color: C.paper }]}>כניסות לפי איש צוות</Text>
        {staff.length ? staff.map((s) => (
          <View key={s.name} style={[row, { justifyContent: "space-between" }]}>
            <Text style={{ fontFamily: F.body, fontSize: 16, color: C.paper }}>{s.name}</Text>
            <Text style={{ fontFamily: F.mono, fontSize: 16, color: C.muted }}>{s.n}</Text>
          </View>
        )) : <Text style={[rtl, { fontFamily: F.body, fontSize: 15, color: C.muted }]}>עוד אין כניסות.</Text>}
        {door.conflicts ? <Text style={[rtl, { fontFamily: F.bodyBold, fontSize: 15, color: C.red }]}>{door.conflicts} כרטיסים שנסרקו בלי קליטה כבר נכנסו מדלת אחרת</Text> : null}
      </View>
      <Text style={[rtl, { fontFamily: F.body, fontSize: 14, color: C.faint }]}>נתונים ספורים בלבד. פרטי הקונים נשארים אצל המארגן.</Text>
    </ScrollView>
  );
}
