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
 */
export default function Ishmael() {
  const { messages, identity, reveal, tone, isStreaming, error, lastFailed, send, retry, reset } =
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

  return (
    <div
      className="ishmael-room flex min-h-[100dvh] justify-center p-3 sm:p-6"
      data-phase={phase}
      data-reveal={reveal}
      data-tone={tone}>
      <div className="flex w-full max-w-[30rem] flex-col overflow-hidden rounded-[2rem] border border-[#c9a24d]/25 bg-[#100d0b]/80 shadow-[0_0_80px_rgba(0,0,0,0.7)]">
        <header className="flex items-center justify-between px-5 pb-2 pt-4">
          <button
            type="button"
            onClick={reset}
            className="text-[0.7rem] tracking-wide text-[#c9a24d]/50 transition-colors hover:text-[#c9a24d]">
            להתחיל מחדש
          </button>
          <Search className="h-5 w-5 text-[#c9a24d]/80" strokeWidth={1.5} aria-hidden />
        </header>

        {/* מעבר לזכוכית */}
        <div className="ishmael-glass mx-4 aspect-[802/537] rounded-2xl border border-[#c9a24d]/40">
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
          <div className="ishmael-shaft" aria-hidden />
          <div className="ishmael-glare" aria-hidden />
        </div>

        <main className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
          {messages.map(m =>
            m.role === "assistant" ? (
              <div key={m.id} dir="ltr" className="flex items-start gap-2.5">
                <img
                  src="/art/avatar-ishmael.png"
                  alt=""
                  aria-hidden
                  className="mt-0.5 h-11 w-11 shrink-0 rounded-full"
                />
                <p
                  dir="rtl"
                  className="max-w-[78%] whitespace-pre-wrap rounded-2xl rounded-tl-md bg-[#2a2a20]/70 px-4 py-2.5 text-right text-[0.92rem] leading-relaxed text-[#e6dcc6]">
                  {m.content}
                </p>
              </div>
            ) : (
              <div key={m.id} dir="ltr" className="flex items-start justify-end gap-2.5">
                <p
                  dir="rtl"
                  className="max-w-[78%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-[#c5a05a] px-4 py-2.5 text-right text-[0.92rem] leading-relaxed text-[#20180d]">
                  {m.content}
                </p>
                <img
                  src="/art/avatar-you.png"
                  alt=""
                  aria-hidden
                  className="mt-0.5 h-11 w-11 shrink-0 rounded-full"
                />
              </div>
            )
          )}

          {isStreaming && messages.at(-1)?.content === "" && (
            <div dir="ltr" className="flex items-center gap-2.5">
              <img
                src="/art/avatar-ishmael.png"
                alt=""
                aria-hidden
                className="h-11 w-11 shrink-0 rounded-full opacity-60"
              />
              <span className="text-[0.8rem] text-[#c9a24d]/50">…</span>
            </div>
          )}

          {error && (
            <div dir="rtl" className="flex items-center gap-3 text-[0.82rem] text-[#c9a24d]/60">
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
          <div className="flex items-center gap-2 rounded-full border border-[#c9a24d]/40 bg-[#171310]/60 py-1.5 pe-1.5 ps-5">
            <input
              dir="rtl"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder={identity.name ? "" : "…"}
              aria-label="הודעה"
              className="flex-1 bg-transparent text-[0.92rem] text-[#e6dcc6] outline-none placeholder:text-[#c9a24d]/30"
            />
            <button
              type="submit"
              disabled={isStreaming || draft.trim().length === 0}
              aria-label="שלח"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#c5a05a] text-[#20180d] transition-opacity disabled:opacity-40">
              <Send className="h-5 w-5 -scale-x-100" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
