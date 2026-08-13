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
  isMemoryEmpty,
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
  /** מסמן שזו ההודעה הפותחת של recap אוטומטי, כדי להציג צ'יפים אחריה */
  isRecap?: boolean;
  /** האינדקס שבו מתחיל המקטע האחרון שנחשף — לאנימציית הכניסה שלו */
  lastChunkStart?: number;
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
  const journey = readJourney(
    typeof window === "undefined" ? null : window.localStorage
  );
  const name = readProfile(
    typeof window === "undefined" ? null : window.localStorage
  ).name;
  return { ...journey, memory: stripNameArtifacts(journey.memory, name) };
}

/**
 * ניקוי חד-פעמי (רץ בכל טעינה, אבל אין מה לנקות אחרי הפעם הראשונה):
 * גרסה קודמת של הפרומפט הורתה למודל לכתוב זיכרון בגוף שלישי, מה שגרם
 * לפריטים כמו "שמו טל" להישמר כ"עובדה" — מיותר וגם מוזר להצגה למשתמש
 * עצמו. זה מנקה שאריות כאלה מזיכרון שכבר נשמר, אצל כל מי שמעדכן,
 * בלי שצריך גישה לנתונים של אף אחד (הכל רץ מקומית בדפדפן שלו).
 */
function stripNameArtifacts(
  memory: JourneyMemory,
  name: string
): JourneyMemory {
  if (!name) return memory;

  const isNameArtifact = (item: string) => {
    const trimmed = item.trim();
    return (
      trimmed === name ||
      trimmed === `שמו ${name}` ||
      trimmed === `השם שלו ${name}` ||
      trimmed === `שם: ${name}` ||
      trimmed === `שמו: ${name}`
    );
  };

  const clean = (list: string[]) => list.filter(item => !isNameArtifact(item));

  return {
    ...memory,
    life: clean(memory.life),
    themes: clean(memory.themes),
    strengths: clean(memory.strengths),
    insights: clean(memory.insights),
    emotions: clean(memory.emotions),
    values: clean(memory.values),
    goals: clean(memory.goals),
  };
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
  const [contextualStarters, setContextualStarters] = useState<string[]>([]);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(
    null
  );
  const abortRef = useRef<AbortController | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      if (revealTimerRef.current) clearInterval(revealTimerRef.current);
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

  /**
   * מריץ בקשת streaming אחת ומזרים אותה לתוך הודעת עוזר קיימת, כולל
   * חשיפה עדינה ("כמו נשימה") שמנותקת מקצב ההגעה הגולמי מהרשת.
   * משותף בין send() (הודעה רגילה) ובין recap אוטומטי בחזרה לשיחה —
   * שניהם צריכים בדיוק את אותה זרימה, רק עם body שונה בבקשה.
   */
  const runStream = useCallback(
    async (
      assistantId: string,
      requestBody: Record<string, unknown>,
      signal: AbortSignal
    ): Promise<{ text: string; streamError: string | null }> => {
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
        signal,
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

      // --- חשיפה חלקה, מנותקת מקצב ההגעה הגולמי מהרשת ---
      // הטקסט הגולמי מצטבר מיד ב-accumulated, אבל מה שמוצג על המסך
      // (revealedLength) "רודף" אחריו בעדינות, כמו נשימה — לא קופץ
      // בקפיצות לפי גודל המקטעים שהגיעו מהרשת. ה-easing (חשיפת חלק
      // מהפער בכל טיק, לא כמות קבועה) נותן תחושה טבעית: מהיר כשיש
      // הרבה טקסט ממתין, ומאט כשמתקרבים לסוף.
      let revealedLength = 0;
      const REVEAL_TICK_MS = 60;
      let onCaughtUp: (() => void) | null = null;

      const tickReveal = () => {
        if (revealedLength < accumulated.length) {
          const gap = accumulated.length - revealedLength;
          // חושף כחמישית מהפער שנשאר בכל טיק (מינימום תו אחד) —
          // עקומת האטה טבעית במקום קצב קבוע ומכני.
          const step = Math.max(1, Math.min(4, Math.ceil(gap / 22)));
          const chunkStart = revealedLength;
          revealedLength = Math.min(accumulated.length, revealedLength + step);
          const shown = accumulated.slice(0, revealedLength);
          setMessages(prev =>
            prev.map(m =>
              m.id === assistantId
                ? { ...m, content: shown, lastChunkStart: chunkStart }
                : m
            )
          );
        }
        if (revealedLength >= accumulated.length) {
          if (revealTimerRef.current) {
            clearInterval(revealTimerRef.current);
            revealTimerRef.current = null;
          }
          onCaughtUp?.();
          onCaughtUp = null;
        }
      };

      const ensureRevealLoop = () => {
        if (!revealTimerRef.current) {
          revealTimerRef.current = setInterval(tickReveal, REVEAL_TICK_MS);
        }
      };

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
              prev.map(m => (m.id === assistantId ? { ...m, safety: level } : m))
            );
            return;
          }

          if (event.type === "delta" && typeof event.text === "string") {
            accumulated += event.text;
            ensureRevealLoop();
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

      // הרשת סיימה, אבל אם החשיפה על המסך עוד לא הדביקה את הטקסט
      // המלא — מחכים שהיא תסיים לפני שממשיכים, כדי שהטקסט לא "יקפוץ"
      // ישר לסיום ברגע שהרשת נגמרת.
      if (revealedLength < accumulated.length) {
        await new Promise<void>(resolve => {
          onCaughtUp = resolve;
        });
      }

      return { text: accumulated, streamError };
    },
    []
  );

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim().slice(0, MAX_MESSAGE_LENGTH);
      if (text.length === 0 || isStreaming) return;

      setError(null);
      setLastFailedMessage(null);
      setContextualStarters([]);

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
        const { text: accumulated, streamError } = await runStream(
          assistantId,
          {
            message: text,
            history,
            memory: journeyRef.current.memory,
            profile: profileRef.current,
            isReturningVisit: isReturningVisit || startsNewSession,
          },
          controller.signal
        );

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
        if (revealTimerRef.current) {
          clearInterval(revealTimerRef.current);
          revealTimerRef.current = null;
        }
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
    [isStreaming, isReturningVisit, messages, refreshMemory, runStream]
  );

  /**
   * ריקאפ אוטומטי: כשמישהו חוזר אחרי הפסקה ויש לו כבר שיחה קודמת,
   * העוזר פותח ביוזמתו במקום לחכות שהמשתמש יכתוב קודם. נכשל בשקט —
   * זו פעולה יזומה מהאפליקציה, לא בקשה של המשתמש, אז לא מציגים
   * שגיאה אם זה לא מסתדר; פשוט לא יהיה recap הפעם.
   */
  const hasCheckedRecapRef = useRef(false);

  const fetchContextualStarters = useCallback(async (recapText: string) => {
    try {
      const response = await fetch("/api/journey/starters", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recapText }),
      });
      if (!response.ok) return;
      const data = (await response.json()) as { starters?: unknown };
      if (Array.isArray(data.starters)) {
        setContextualStarters(
          data.starters.filter((s): s is string => typeof s === "string")
        );
      }
    } catch {
      // כשל שקט — כפתורי הפתיחה הגנריים ישמשו כברירת מחדל במקום
    }
  }, []);

  const maybeSendRecap = useCallback(async () => {
    if (isStreaming) return;

    const assistantId = createId();
    const history = messages.slice(-MAX_HISTORY_MESSAGES).map(m => ({
      role: m.role,
      content: m.content,
    }));

    setMessages(prev => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", sessionStart: true, isRecap: true },
    ]);
    setIsStreaming(true);

    const now = Date.now();
    setJourney(prev => ({
      ...prev,
      lastVisitAt: now,
      sessionCount: prev.sessionCount + 1,
    }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const { text: accumulated, streamError } = await runStream(
        assistantId,
        {
          isRecapTrigger: true,
          history,
          memory: journeyRef.current.memory,
          profile: profileRef.current,
          isReturningVisit: true,
        },
        controller.signal
      );

      if (streamError || accumulated.trim().length === 0) {
        setMessages(prev => prev.filter(m => m.id !== assistantId));
      } else {
        // הצלחה: לא מרעננים זיכרון על recap (לא נאמר בו שום דבר חדש
        // מהמשתמש, אין מה לחלץ) — אבל כן מביאים הצעות תגובה רלוונטיות
        // להודעה הזו, במקום כפתורי הפתיחה הגנריים.
        void fetchContextualStarters(accumulated);
      }
    } catch {
      if (revealTimerRef.current) {
        clearInterval(revealTimerRef.current);
        revealTimerRef.current = null;
      }
      setMessages(prev => prev.filter(m => m.id !== assistantId));
    } finally {
      abortRef.current = null;
      setIsStreaming(false);
    }
  }, [isStreaming, messages, runStream]);

  // מפעיל recap פעם אחת בטעינה, רק אם באמת יש למה לחזור: זו חזרה
  // אחרי הפסקה, יש כבר שיחה קודמת על המסך, ויש זיכרון שאפשר להתייחס
  // אליו (אחרת אין ל-recap על מה לדבר).
  useEffect(() => {
    if (hasCheckedRecapRef.current) return;
    hasCheckedRecapRef.current = true;

    if (!isReturningVisit) return;
    if (messages.length === 0) return;
    if (isMemoryEmpty(journeyRef.current.memory)) return;

    void maybeSendRecap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    contextualStarters,
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
