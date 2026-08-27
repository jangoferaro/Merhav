import { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_IDENTITY,
  EMPTY_LEARNER_STATE,
  ISHMAEL_CONVERSATION_STORAGE_KEY,
  ISHMAEL_IDENTITY_STORAGE_KEY,
  ISHMAEL_LEARNER_STORAGE_KEY,
  ISHMAEL_MAX_HISTORY_MESSAGES,
  ISHMAEL_MAX_MESSAGE_LENGTH,
  type Identity,
  type LearnerState,
  type RevealState,
  type Tone,
} from "@shared/ishmael";

export type IshmaelMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

/** סימן פנימי: הכשל היה בפתיחה, ולכן הניסיון החוזר הוא פתיחה מחדש. */
const OPENING_RETRY = "\u0000opening";

const createId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

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
    // אחסון חסום או מלא — ההתקדמות פשוט לא תישמר
  }
}

/**
 * הצד הלקוחי של המנוע. הכל נשמר במכשיר בלבד, כמו בשאר האפליקציה:
 * מצב הלמידה (מה נתפס, באיזה שלב) הוא זיכרון של השיחה, לא פרופיל
 * שנשמר אצל מישהו.
 */
export function useIshmael() {
  const [messages, setMessages] = useState<IshmaelMessage[]>(
    () => readJson<IshmaelMessage[]>(ISHMAEL_CONVERSATION_STORAGE_KEY) ?? []
  );
  const [learner, setLearner] = useState<LearnerState>(
    () => readJson<LearnerState>(ISHMAEL_LEARNER_STORAGE_KEY) ?? EMPTY_LEARNER_STATE
  );
  const [identity, setIdentity] = useState<Identity>(
    () => readJson<Identity>(ISHMAEL_IDENTITY_STORAGE_KEY) ?? EMPTY_IDENTITY
  );
  const [reveal, setReveal] = useState<RevealState>("concealed");
  /** בקשת התגלות שאושרה בתור הקודם ומחכה לתור הבא. */
  const [revealPending, setRevealPending] = useState(false);
  const [tone, setTone] = useState<Tone>("still");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailed, setLastFailed] = useState<string | null>(null);
  const openedRef = useRef(false);

  useEffect(() => {
    writeJson(ISHMAEL_CONVERSATION_STORAGE_KEY, messages);
  }, [messages]);

  useEffect(() => {
    writeJson(ISHMAEL_LEARNER_STORAGE_KEY, learner);
  }, [learner]);

  useEffect(() => {
    writeJson(ISHMAEL_IDENTITY_STORAGE_KEY, identity);
  }, [identity]);

  const run = useCallback(
    async (text: string, isOpening: boolean) => {
      setIsStreaming(true);
      setError(null);

      const assistantId = createId();
      let received = false;
      let streamFailed = false;

      setMessages(prev => [...prev, { id: assistantId, role: "assistant", content: "" }]);

      try {
        const history = messages
          .slice(-ISHMAEL_MAX_HISTORY_MESSAGES)
          .map(m => ({ role: m.role, content: m.content }));

        const response = await fetch("/api/ishmael/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: text,
            history,
            learner,
            identity,
            reveal,
            revealPending,
            isOpening,
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error("stream failed to start");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const raw = trimmed.slice(5).trim();
            if (!raw) continue;

            let event: Record<string, unknown>;
            try {
              event = JSON.parse(raw);
            } catch {
              continue;
            }

            if (event.type === "state" && event.learner) {
              setLearner(event.learner as LearnerState);
            } else if (event.type === "identity" && event.identity) {
              setIdentity(event.identity as Identity);
            } else if (event.type === "reveal" && event.reveal) {
              // האור נדלק בדיוק כאן — לפני המילים הראשונות של התור הזה
              const next = event.reveal as RevealState;
              setReveal(next);
              if (next !== "concealed") setRevealPending(false);
            } else if (event.type === "revealPending") {
              setRevealPending(true);
            } else if (event.type === "tone" && event.tone) {
              setTone(event.tone as Tone);
            } else if (event.type === "delta" && typeof event.content === "string") {
              received = true;
              const chunk = event.content;
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId ? { ...m, content: m.content + chunk } : m
                )
              );
            } else if (event.type === "error") {
              streamFailed = true;
              setError(typeof event.message === "string" ? event.message : "משהו נקטע.");
            }
          }
        }
      } catch {
        streamFailed = true;
        setError("משהו נקטע באמצע. אפשר לנסות שוב.");
      } finally {
        // כשל תמיד מנצח: בועה שהספיקה לקבל רסיס טקסט לפני שהזרימה
        // נפלה נמחקת, כדי שלא תישאר תשובה חתוכה על המסך.
        if (streamFailed || !received) {
          setMessages(prev => prev.filter(m => m.id !== assistantId));
          // גם פתיחה שנכשלה צריכה כפתור. בלי זה המשתמש מקבל חדר חשוך
          // עם הודעת שגיאה ושום דרך להתחיל — וזה בדיוק הרגע הראשון שלו.
          setLastFailed(isOpening ? OPENING_RETRY : text);
        } else {
          setLastFailed(null);
        }
        setIsStreaming(false);
      }
    },
    [identity, learner, messages, reveal, revealPending]
  );

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim().slice(0, ISHMAEL_MAX_MESSAGE_LENGTH);
      if (!text || isStreaming) return;
      setMessages(prev => [...prev, { id: createId(), role: "user", content: text }]);
      void run(text, false);
    },
    [isStreaming, run]
  );

  const retry = useCallback(() => {
    if (!lastFailed || isStreaming) return;
    if (lastFailed === OPENING_RETRY) {
      void run("", true);
      return;
    }
    void run(lastFailed, false);
  }, [isStreaming, lastFailed, run]);

  const reset = useCallback(() => {
    setMessages([]);
    setLearner(EMPTY_LEARNER_STATE);
    setIdentity(EMPTY_IDENTITY);
    setReveal("concealed");
    setRevealPending(false);
    setTone("still");
    setError(null);
    setLastFailed(null);
    openedRef.current = false;
  }, []);

  // פתיחה יזומה — המנוע פותח בשאלה, כמו מורה ולא כמו עוזר שמחכה.
  useEffect(() => {
    if (openedRef.current || messages.length > 0) return;
    openedRef.current = true;
    void run("", true);
  }, [messages.length, run]);

  return {
    messages,
    learner,
    identity,
    reveal,
    tone,
    isStreaming,
    error,
    lastFailed,
    send,
    retry,
    reset,
  };
}
