import { useEffect, useRef, useState } from "react";
import { Search, Send } from "lucide-react";
import { useIshmael } from "@/hooks/useIshmael";
import { currentPhase, resolveCoords, type Coords } from "@/lib/daylight";
import type { LightPhase } from "@shared/ishmael";

/**
 * החדר.
 *
 * שלושה דברים משתנים כאן בלי שהמשתמש נוגע בכלום: מי שמעבר לזכוכית
 * (מוסתר או גלוי), מה הוא עושה ברגע הזה (הטון שמניע את ההנפשה),
 * והאור — שנקבע לפי השעה שבה האדם באמת יושב מול המסך.
 *
 * הכיווניות כאן מכוונת: המסגרת עצמה LTR כדי לשמור על הקומפוזיציה
 * המעוצבת (חיפוש בפינה הימנית, שליחה בימין, ישמעאל בצד שמאל של
 * השיחה), והטקסט בתוך כל בועה RTL כי הוא עברית.
 */
export default function Ishmael() {
  const { messages, reveal, tone, isStreaming, error, lastFailed, send, retry, reset } =
    useIshmael();
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<LightPhase>(() => currentPhase(new Date(), null));
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // האור נבדק מחדש כל דקה — כדי ששקיעה תיכנס לחדר בזמן אמת ולא רק
  // אצל מי שטרח לרענן.
  useEffect(() => {
    let coords: Coords | null = null;
    let cancelled = false;

    const tick = () => {
      if (!cancelled) setPhase(currentPhase(new Date(), coords));
    };

    void resolveCoords().then(c => {
      coords = c;
      tick();
    });

    const timer = window.setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || isStreaming) return;
    send(draft);
    setDraft("");
  };

  const waiting = isStreaming && messages.at(-1)?.content === "";

  return (
    <div
      dir="ltr"
      className="ishmael-room flex min-h-[100dvh] justify-center p-3 sm:p-6"
      data-phase={phase}
      data-reveal={reveal}
      data-tone={tone}>
      <div className="ishmael-frame flex w-full max-w-[30rem] flex-col overflow-hidden rounded-[2rem]">
        <header className="flex items-center justify-between px-5 pb-2.5 pt-4">
          <button
            type="button"
            onClick={reset}
            dir="rtl"
            className="text-[0.7rem] tracking-wide text-[#c9a24d]/40 transition-colors hover:text-[#c9a24d]">
            להתחיל מחדש
          </button>
          <Search className="h-5 w-5 text-[#c9a24d]/80" strokeWidth={1.5} aria-hidden />
        </header>

        {/* מעבר לזכוכית */}
        <div className="ishmael-glass mx-4 aspect-[802/537] rounded-2xl">
          <div className="ishmael-figure absolute inset-0">
            <img
              src="/art/ishmael-concealed.png"
              alt=""
              aria-hidden
              className="ishmael-plate"
              data-layer="concealed"
            />
            <img
              src="/art/ishmael-revealed.png"
              alt={reveal === "concealed" ? "" : "ישמעאל"}
              aria-hidden={reveal === "concealed"}
              className="ishmael-plate"
              data-layer="revealed"
            />
          </div>

          {/* האור תופס את עיניו לרגע. זה כל מה שרואים ממנו בחושך. */}
          <div className="ishmael-eyes" aria-hidden>
            <span />
            <span />
          </div>

          <div className="ishmael-shaft" aria-hidden />
          <div className="ishmael-dust" aria-hidden />
          <div className="ishmael-bloom" aria-hidden />
          <div className="ishmael-glare" aria-hidden />
          <div className="ishmael-grain" aria-hidden />
        </div>

        <main className="ishmael-thread flex-1 space-y-2.5 overflow-y-auto px-4 py-5">
          {messages.map(m =>
            m.role === "assistant" ? (
              <div key={m.id} className="ishmael-enter flex items-end gap-2.5">
                <img
                  src="/art/avatar-ishmael.png"
                  alt=""
                  aria-hidden
                  className="h-11 w-11 shrink-0 rounded-full"
                />
                <p dir="rtl" className="ishmael-bubble ishmael-bubble-him">
                  {m.content}
                </p>
              </div>
            ) : (
              <div key={m.id} className="ishmael-enter flex items-end justify-end gap-2.5">
                <p dir="rtl" className="ishmael-bubble ishmael-bubble-you">
                  {m.content}
                </p>
                <img
                  src="/art/avatar-you.png"
                  alt=""
                  aria-hidden
                  className="h-11 w-11 shrink-0 rounded-full"
                />
              </div>
            )
          )}

          {waiting && (
            <div className="ishmael-enter flex items-end gap-2.5">
              <img
                src="/art/avatar-ishmael.png"
                alt=""
                aria-hidden
                className="h-11 w-11 shrink-0 rounded-full opacity-70"
              />
              <div className="ishmael-bubble ishmael-bubble-him ishmael-thinking" aria-label="חושב">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}

          {error && (
            <div dir="rtl" className="flex items-center gap-3 pt-1 text-[0.82rem] text-[#c9a24d]/60">
              <span>{error}</span>
              {lastFailed && (
                <button
                  type="button"
                  onClick={retry}
                  className="rounded-full border border-[#c9a24d]/40 px-3 py-1 text-[#e6dcc6] transition-colors hover:border-[#c9a24d]">
                  לנסות שוב
                </button>
              )}
            </div>
          )}

          <div ref={endRef} />
        </main>

        <form onSubmit={submit} className="px-4 pb-5 pt-1">
          <div className="ishmael-composer flex items-center gap-2 rounded-full py-1.5 pl-5 pr-1.5">
            <input
              dir="rtl"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              aria-label="הודעה"
              className="flex-1 bg-transparent text-right text-[0.92rem] text-[#e6dcc6] outline-none placeholder:text-[#c9a24d]/25"
            />
            <button
              type="submit"
              disabled={isStreaming || draft.trim().length === 0}
              aria-label="שלח"
              className="ishmael-send grid h-11 w-11 shrink-0 place-items-center rounded-full">
              <Send className="h-5 w-5 -scale-x-100" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
