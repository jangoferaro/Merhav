import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useIshmael } from "@/hooks/useIshmael";
import { STAGE_ORDER, type Stage } from "@shared/ishmael";

const STAGE_LABELS: Record<Stage, string> = {
  captivity: "השבי",
  story: "סיפור",
  "taker-story": "סיפור הלוקחים",
  law: "החוק",
  "leaver-story": "סיפור המשאירים",
  diversity: "מגוון",
  remembering: "היזכרות",
  beyond: "מה עושים",
};

/**
 * מסך המנוע. שני חלקים: השיחה, ופס התקדמות שמראה איפה היא נמצאת
 * בקוריקולום — כי מנוע שיש לו אג׳נדה צריך להראות אותה, לא להסתיר.
 */
export default function Ishmael() {
  const { messages, learner, isStreaming, error, lastFailed, send, retry, reset } =
    useIshmael();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const stageIndex = useMemo(
    () => Math.max(0, STAGE_ORDER.indexOf(learner.stage)),
    [learner.stage]
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    send(draft);
    setDraft("");
  };

  return (
    <div dir="rtl" className="relative flex min-h-[100dvh] flex-col">
      <div className="merhav-ambient" aria-hidden />

      <header className="relative z-10 flex items-center justify-between border-b border-border/60 px-5 py-3">
        <div>
          <h1 className="font-display text-[1.15rem] text-foreground">ישמעאל</h1>
          <p className="text-[0.75rem] text-muted-foreground">
            מנוע ידע עם עמדה — לא עוזר ניטרלי
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-full border border-border px-3 py-1.5 text-[0.75rem] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
            להתחיל מחדש
          </button>
          <Link
            href="/"
            className="text-[0.75rem] text-muted-foreground transition-colors hover:text-foreground">
            מרחב
          </Link>
        </div>
      </header>

      {/* פס הקוריקולום — איפה השיחה נמצאת ומה כבר נתפס */}
      <nav
        className="relative z-10 flex items-center gap-1 overflow-x-auto border-b border-border/40 px-5 py-2"
        aria-label="שלבי השיחה">
        {STAGE_ORDER.map((stage, i) => (
          <div
            key={stage}
            className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[0.7rem] transition-colors ${
              i === stageIndex
                ? "bg-primary/15 text-primary"
                : i < stageIndex
                  ? "text-sage"
                  : "text-muted-foreground/50"
            }`}>
            {STAGE_LABELS[stage]}
          </div>
        ))}
        {learner.grasped.length > 0 && (
          <span className="mr-auto whitespace-nowrap text-[0.7rem] text-muted-foreground">
            {learner.grasped.length} מושגים
          </span>
        )}
      </nav>

      <main className="relative z-10 flex-1 space-y-4 overflow-y-auto px-5 py-6">
        {messages.map(m => (
          <div
            key={m.id}
            className={`max-w-[42rem] whitespace-pre-wrap text-[0.95rem] leading-relaxed ${
              m.role === "user"
                ? "mr-auto rounded-2xl bg-card/70 px-4 py-2.5 text-foreground"
                : "text-foreground/90"
            }`}>
            {m.content}
          </div>
        ))}

        {isStreaming && messages.at(-1)?.content === "" && (
          <p className="text-[0.85rem] text-muted-foreground">חושב…</p>
        )}

        {error && (
          <div className="flex items-center gap-3 text-[0.85rem] text-muted-foreground">
            <span>{error}</span>
            {lastFailed && (
              <button
                type="button"
                onClick={retry}
                className="rounded-full border border-border px-3 py-1 text-foreground transition-colors hover:border-primary/40">
                לנסות שוב
              </button>
            )}
          </div>
        )}

        <div ref={endRef} />
      </main>

      <form
        onSubmit={submit}
        className="relative z-10 flex items-end gap-2 border-t border-border/60 px-5 py-3">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) submit(e);
          }}
          rows={1}
          placeholder="תשאל, או תתווכח"
          className="max-h-40 flex-1 resize-none rounded-2xl border border-border bg-card/50 px-4 py-2.5 text-[0.95rem] text-foreground outline-none transition-colors focus:border-primary/40"
        />
        <button
          type="submit"
          disabled={isStreaming || draft.trim().length === 0}
          className="rounded-full bg-primary px-4 py-2.5 text-[0.9rem] text-primary-foreground transition-opacity disabled:opacity-40">
          שלח
        </button>
      </form>
    </div>
  );
}
