import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearJourney,
  isNewSession,
  readJourney,
  readProfile,
  writeProfile,
} from "@/lib/journeyStorage";
import {
  CONVERSATION_STORAGE_KEY,
  EMPTY_MEMORY,
  EMPTY_PROFILE,
  JOURNEY_STORAGE_KEY,
  MAX_HISTORY_MESSAGES,
  MAX_MESSAGE_LENGTH,
  NEW_SESSION_GAP_MS,
  type JourneyMemory,
  type JourneyState,
  type Profile,
} from "@shared/merhav";

export type RiskLevel = "none" | "elevated" | "acute";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  safety?: RiskLevel;
  /** מסמן את ההודעה הראשונה של מפגש חדש, לצורך מפריד חזותי */
  sessionStart?: boolean;
};

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // אחסון חסום או מלא — המסע פשוט לא יישמר
  }
}

function loadConversation(): ChatMessage[] {
  const stored = readJson<{ messages: ChatMessage[] }>(
    CONVERSATION_STORAGE_KEY
  );
  if (!stored || !Array.isArray(stored.messages)) return [];
  return stored.messages.filter(
    m =>
      m &&
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string"
  );
}

function loadJourney(): JourneyState {
  return readJourney(
    typeof window === "undefined" ? null : window.localStorage
  );
}

export function useMerhavChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadConversation()
  );
  const [journey, setJourney] = useState<JourneyState>(() => loadJourney());
  const [profile, setProfileState] = useState<Profile>(() =>
    readProfile(typeof window === "undefined" ? null : window.localStorage)
  );
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(
    null
  );
  const abortRef = useRef<AbortController | null>(null);

  // האם זו חזרה אחרי הפסקה — נקבע פעם אחת בטעינה ולא משתנה תוך כדי
  const [isReturningVisit] = useState(() =>
    isNewSession(loadJourney().lastVisitAt)
  );

  const journeyRef = useRef(journey);
  journeyRef.current = journey;

  const profileRef = useRef(profile);
  profileRef.current = profile;

  const saveProfile = useCallback((next: Profile) => {
    setProfileState(next);
    writeProfile(
      typeof window === "undefined" ? null : window.localStorage,
      next
    );
  }, []);

  useEffect(() => {
    writeJson(CONVERSATION_STORAGE_KEY, { messages });
  }, [messages]);

  useEffect(() => {
    writeJson(JOURNEY_STORAGE_KEY, journey);
  }, [journey]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setError(null);
    setIsStreaming(false);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(CONVERSATION_STORAGE_KEY);
      } catch {
        // אין מה לעשות
      }
    }
  }, []);

  /** מוחק גם את הזיכרון — כל המסע נעלם */
  const forgetEverything = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setError(null);
    setIsStreaming(false);

    const fresh: JourneyState = {
      memory: { ...EMPTY_MEMORY },
      sessionCount: 0,
      lastVisitAt: 0,
      startedAt: Date.now(),
    };
    setJourney(fresh);
    saveProfile({ ...EMPTY_PROFILE });

    clearJourney(typeof window === "undefined" ? null : window.localStorage);
  }, [saveProfile]);

  /** מרענן את הזיכרון בשרת אחרי שהתשובה הושלמה */
  const refreshMemory = useCallback(
    async (turns: { role: "user" | "assistant"; content: string }[]) => {
      try {
        const response = await fetch("/api/journey/memory", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            memory: journeyRef.current.memory,
            turns,
          }),
        });

        if (!response.ok) return;

        const data = (await response.json()) as { memory?: JourneyMemory };
        if (data?.memory) {
          setJourney(prev => ({ ...prev, memory: data.memory as JourneyMemory }));
        }
      } catch {
        // הזיכרון פשוט לא יתעדכן הפעם
      }
    },
    []
  );

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim().slice(0, MAX_MESSAGE_LENGTH);
      if (text.length === 0 || isStreaming) return;

      setError(null);
      setLastFailedMessage(null);

      const now = Date.now();
      const previousVisit = journeyRef.current.lastVisitAt;
      const startsNewSession = isNewSession(previousVisit, now);
      const isFirstEver = previousVisit === 0;

      const userMessage: ChatMessage = {
        id: createId(),
        role: "user",
        content: text,
        sessionStart: startsNewSession,
      };
      const assistantId = createId();

      const history = messages.slice(-MAX_HISTORY_MESSAGES).map(m => ({
        role: m.role,
        content: m.content,
      }));

      setMessages(prev => [
        ...prev,
        userMessage,
        { id: assistantId, role: "assistant", content: "" },
      ]);
      setIsStreaming(true);

      setJourney(prev => ({
        ...prev,
        lastVisitAt: now,
        sessionCount:
          isFirstEver || startsNewSession
            ? prev.sessionCount + 1
            : Math.max(prev.sessionCount, 1),
      }));

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: text,
            history,
            memory: journeyRef.current.memory,
            profile: profileRef.current,
            isReturningVisit: isReturningVisit || startsNewSession,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(
            response.status === 429
              ? "יש רגע להמתין. נסה שוב בעוד דקה."
              : "משהו נתקע כאן לרגע. אפשר לנסות לשלוח שוב."
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let accumulated = "";
        // מוגדר ברגע שהשרת עצמו מדווח על כשל בזרימה. חשוב להפריד את זה
        // מ"accumulated" כי לפעמים מגיע רסיס טקסט (למשל תו בודד) לפני
        // שהזרימה נכשלת — ובלי הדגל הזה הרסיס הזה היה נשאר על המסך
        // כאילו הייתה תשובה אמיתית.
        let streamError: string | null = null;

        const flushLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) return;

          const payload = trimmed.slice(5).trim();
          if (!payload) return;

          try {
            const event = JSON.parse(payload) as {
              type: string;
              text?: string;
              level?: RiskLevel;
              message?: string;
            };

            if (event.type === "safety" && event.level) {
              const level = event.level;
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId ? { ...m, safety: level } : m
                )
              );
              return;
            }

            if (event.type === "delta" && typeof event.text === "string") {
              accumulated += event.text;
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId ? { ...m, content: accumulated } : m
                )
              );
              return;
            }

            if (event.type === "error") {
              streamError =
                event.message || "משהו נתקע כאן לרגע. אפשר לנסות לשלוח שוב.";
            }
          } catch {
            // מקטע לא שלם
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          lines.forEach(flushLine);
        }

        if (buffer.trim().length > 0) {
          flushLine(buffer);
        }

        if (streamError || accumulated.trim().length === 0) {
          // או שהשרת דיווח על כשל, או שלא הגיע כלום — בשני המקרים
          // מסירים את בועת התשובה (גם אם הצטבר בה רסיס טקסט חלקי
          // לפני הכשל) ומאפשרים לנסות שוב באותה הודעה.
          setMessages(prev => prev.filter(m => m.id !== assistantId));
          setError(streamError || "לא הגיעה תשובה. אפשר לנסות שוב.");
          setLastFailedMessage(text);
        } else {
          // הזיכרון מתעדכן בשקט, אחרי שהתשובה כבר על המסך
          void refreshMemory([
            ...history,
            { role: "user", content: text },
            { role: "assistant", content: accumulated },
          ]);
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") {
          setMessages(prev =>
            prev.filter(m => m.id !== assistantId || m.content.length > 0)
          );
        } else {
          setMessages(prev => prev.filter(m => m.id !== assistantId));
          setError(
            (err as Error)?.message ||
              "משהו נתקע כאן לרגע. אפשר לנסות לשלוח שוב."
          );
          setLastFailedMessage(text);
        }
      } finally {
        abortRef.current = null;
        setIsStreaming(false);
      }
    },
    [isStreaming, isReturningVisit, messages, refreshMemory]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  /** שולח מחדש את ההודעה האחרונה שנכשלה, בלי שהמשתמש יצטרך להקליד אותה שוב. */
  const retryLast = useCallback(() => {
    if (!lastFailedMessage || isStreaming) return;
    void send(lastFailedMessage);
  }, [lastFailedMessage, isStreaming, send]);

  return {
    messages,
    isStreaming,
    error,
    lastFailedMessage,
    send,
    retryLast,
    stop,
    reset,
    forgetEverything,
    journey,
    profile,
    saveProfile,
    isReturningVisit,
    hasConversation: messages.length > 0,
    hasJourney: journey.lastVisitAt > 0,
  };
}
