// אורח בלי טלפון: חיפוש לפי שם, שם המזמין או סוף הקוד, והכנסה בלחיצה.
import React, { useEffect, useState } from "react";
import { FlatList, Text, TextInput, View } from "react-native";
import type { SearchRow } from "../api";
import type { Door } from "../useDoor";
import { Button, Header } from "../ui";
import { C, F, row, rtl } from "../theme";

export default function Search({ door, onBack }: { door: Door; onBack: () => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [done, setDone] = useState<Record<number, string>>({});

  useEffect(() => {
    const t = setTimeout(async () => setRows(await door.search(q)), 250);
    return () => clearTimeout(t);
  }, [q, door.search]);

  const admit = async (r: SearchRow) => {
    await door.admitById(r.id);
    setDone((d) => ({ ...d, [r.id]: new Date().toISOString() }));
  };

  return (
    <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 8, gap: 16 }}>
      <Header title="אורח בלי טלפון" onBack={onBack} backLabel="חזרה לסריקה" />
      <View style={{ gap: 8 }}>
        <Text style={[rtl, { fontFamily: F.body, fontSize: 15, color: C.muted }]}>שם על הכרטיס, שם המזמין, או סוף הקוד</Text>
        <TextInput
          autoFocus
          value={q}
          onChangeText={setQ}
          accessibilityLabel="חיפוש לפי שם"
          autoCorrect={false}
          style={[rtl, { height: 58, borderRadius: 16, borderWidth: 2, borderColor: C.acid, backgroundColor: C.card, color: C.paper, fontFamily: F.title, fontSize: 22, paddingHorizontal: 16 }]}
        />
      </View>
      {door.shown.kind !== "idle" && door.shown.at > Date.now() - 4000 ? (
        <Text style={[rtl, { fontFamily: F.bodyBold, fontSize: 17, color: door.shown.good ? C.acid : C.red }]} accessibilityLiveRegion="assertive">
          {door.shown.title}{door.shown.name ? ` · ${door.shown.name}` : ""}
        </Text>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 10, paddingBottom: 24 }}
        ListEmptyComponent={q.trim().length >= 2 ? <Text style={[rtl, { fontFamily: F.body, fontSize: 16, color: C.muted }]}>לא נמצא. נסו חלק מהשם או את 4 התווים האחרונים של הקוד.</Text> : undefined}
        renderItem={({ item: r }) => {
          const used = r.status === "used" || done[r.id];
          const meta = [r.named ? "כרטיס שמי · בדקו תעודה" : r.buyer && r.buyer !== r.name ? `הזמנה של ${r.buyer}` : "כרטיס רגיל", r.q].join(" · ");
          return (
            <View style={[row, { gap: 12, backgroundColor: C.card, borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16, opacity: used ? 0.6 : 1 }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[rtl, { fontFamily: F.title, fontSize: 19, color: C.paper }]}>{r.name}</Text>
                <Text style={[rtl, { fontFamily: F.body, fontSize: 14, color: C.muted }]}>{meta}</Text>
              </View>
              {used ? <Text style={{ fontFamily: F.body, fontSize: 14, color: C.muted }}>{r.used_at || done[r.id] ? `נכנס/ה ${new Date((r.used_at || done[r.id]) as string).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })}` : "נכנס/ה"}</Text> : <Button label="הכנסה" onPress={() => admit(r)} style={{ minHeight: 48 }} accessibilityLabel={`הכנסה של ${r.name}`} />}
            </View>
          );
        }}
      />
      <Text style={[rtl, { fontFamily: F.body, fontSize: 14, color: C.faint, paddingBottom: 12 }]}>כרטיס שמי מסומן. מכניסים רק אחרי בדיקת תעודה. כרטיסים שהוחזרו לא מופיעים בחיפוש.</Text>
    </View>
  );
}
