// JoCares Door: אפליקציית הכניסה לצוות של מקומות, ליינים ואמנים.
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, I18nManager, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as Linking from "expo-linking";
import { useFonts } from "expo-font";
import { Heebo_500Medium, Heebo_800ExtraBold } from "@expo-google-fonts/heebo";
import { Assistant_400Regular, Assistant_600SemiBold } from "@expo-google-fonts/assistant";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono";
import { SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";
import { call, parseJoin, type EventSummary, type Home, type Session } from "./src/api";
import { clearAll, loadSession, saveSession } from "./src/storage";
import { initFeedback } from "./src/feedback";
import { useDoor } from "./src/useDoor";
import { C } from "./src/theme";
import Join from "./src/screens/Join";
import Events from "./src/screens/Events";
import Scanner from "./src/screens/Scanner";
import Search from "./src/screens/Search";
import Stats from "./src/screens/Stats";

// הכיוון מנוהל במסכים עצמם, כך שהתצוגה זהה בכל שפת מכשיר
I18nManager.allowRTL(false);
I18nManager.forceRTL(false);

function EventFlow({ session, event, staffName, onBack }: { session: Session; event: EventSummary; staffName: string; onBack: () => void }) {
  const door = useDoor(session, event.id);
  const [screen, setScreen] = useState<"scan" | "search" | "stats">("scan");
  if (screen === "search") return <Search door={door} onBack={() => setScreen("scan")} />;
  if (screen === "stats") return <Stats door={door} session={session} campaignId={event.id} artist={event.artist} onBack={() => setScreen("scan")} />;
  return <Scanner door={door} event={event} staffName={staffName} onBack={onBack} onSearch={() => setScreen("search")} onStats={() => setScreen("stats")} />;
}

export default function App() {
  const [fonts] = useFonts({ Heebo_500Medium, Heebo_800ExtraBold, Assistant_400Regular, Assistant_600SemiBold, IBMPlexMono_500Medium, SpaceGrotesk_700Bold });
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [home, setHome] = useState<Home | null>(null);
  const [event, setEvent] = useState<EventSummary | null>(null);
  const url = Linking.useURL();

  useEffect(() => {
    initFeedback();
    (async () => {
      const s = await loadSession();
      if (s) {
        setSession(s);
        try {
          setHome(await call<Home>(s, "/me"));
        } catch {
          // בלי קליטה בפתיחה: נכנסים עם מסך ריק ומושכים לרענון
          setHome({ staff: { name: "" }, organizer: { name: "", kind: "" }, events: [] });
        }
      }
      setReady(true);
    })();
  }, []);

  // קישור צוות שנפתח מהודעה (jocares-door://join?u=...) מצטרף ישר
  useEffect(() => {
    if (!url || !ready) return;
    const s = parseJoin(url);
    if (s && s.key !== session?.key) call<Home>(s, "/me").then((h) => joined(s, h)).catch(() => {});
  }, [url, ready]);

  async function joined(s: Session, h: Home) {
    await clearAll();
    await saveSession(s);
    setSession(s);
    setHome(h);
    setEvent(null);
  }

  function logout() {
    Alert.alert("התנתקות", "המפתח האישי והרשימות יימחקו מהמכשיר. כדי לחזור צריך שוב את הקישור מהמארגן.", [
      { text: "ביטול", style: "cancel" },
      { text: "התנתקות", style: "destructive", onPress: async () => { await clearAll(); setSession(null); setHome(null); setEvent(null); } },
    ]);
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }}>
        {!fonts || !ready ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={C.acid} /></View>
        ) : !session || !home ? (
          <Join onJoined={joined} />
        ) : event ? (
          <EventFlow key={event.id} session={session} event={event} staffName={home.staff.name} onBack={() => setEvent(null)} />
        ) : (
          <Events session={session} home={home} onHome={setHome} onPick={setEvent} onLogout={logout} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
