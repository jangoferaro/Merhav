import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, Route, Square } from "lucide-react";
import BreathMark from "@/components/BreathMark";
import Disclaimer from "@/components/Disclaimer";
import HelplinesCard from "@/components/HelplinesCard";
import JourneyPanel from "@/components/JourneyPanel";
import WelcomeForm from "@/components/WelcomeForm";
import { Button } from "@/components/ui/button";
import { useMerhavChat } from "@/hooks/useMerhavChat";
import {
  CONVERSATION_STARTERS,
  MAX_MESSAGE_LENGTH,
  isMemoryEmpty,
} from "@shared/merhav";

/**
 * מציג טקסט עם חשיפה עדינה "כמו נשימה": החלק שכבר "התיישב" הוא טקסט
 * רגיל, והמקטע האחרון שנחשף עטוף ב-span עם fade משלו. ה-key על ה-span
 * הוא ה-chunkStart — כשהוא משתנה, ריאקט יוצר אלמנט חדש (לא מעדכן קיים),
 * מה שמפעיל את האנימציה מחדש על כל מקטע חדש בנפרד, בלי לגעת בטקסט
 * שכבר הוצג.
 */
function StreamingText({
  content,
  chunkStart,
}: {
  content: string;
  chunkStart?: number;
}) {
  if (chunkStart === undefined || chunkStart >= content.length) {
    return <p className="whitespace-pre-wrap">{content}</p>;
  }

  const settled = content.slice(0, chunkStart);
  const fresh = content.slice(chunkStart);

  return (
    <p className="whitespace-pre-wrap">
      {settled}
      <span key={chunkStart} className="merhav-chunk-fade">
        {fresh}
      </span>
    </p>
  );
}

export default function Home() {
  const {
    messages,
    isStreaming,
    error,
    lastFailedMessage,
    contextualStarters,
    send,
    retryLast,
    stop,
    forgetEverything,
    journey,
    profile,
    saveProfile,
    isReturningVisit,
    hasConversation,
  } = useMerhavChat();

  const [draft, setDraft] = useState("");
  const [showJourney, setShowJourney] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [appHeight, setAppHeight] = useState<number | null>(null);

  // נעילת גובה לפי ה-viewport האמיתי שנראה מעל המקלדת. 100dvh לבדו
  // לא תמיד מתעדכן נכון עם פתיחת מקלדת בכל דפדפן/webview — התוצאה
  // הידועה היא שהדפדפן "עוזר" ע"י גלילת כל הדף (כולל ה-header) כדי
  // להראות את השדה הממוקד. VisualViewport.height הוא המקור האמין
  // היחיד ל"מה באמת נראה עכשיו על המסך".
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => {
      const h = vv ? vv.height : window.innerHeight;
      setAppHeight(h);
      if (window.scrollY !== 0 || window.scrollX !== 0) {
        window.scrollTo(0, 0);
      }
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
  }, [draft]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: isStreaming ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, isStreaming]);

  const submit = useCallback(
    (text: string) => {
      const value = text.trim();
      if (value.length === 0 || isStreaming) return;
      setDraft("");
      void send(value);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [isStreaming, send]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(draft);
    }
  };

  const handleForget = () => {
    forgetEverything();
    setDraft("");
    setShowJourney(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const hasMemory = !isMemoryEmpty(journey.memory);
  const knowsUser = hasMemory || journey.sessionCount > 0;
  const needsWelcome = !profile.completed && !hasConversation;

  return (
    <div
      dir="rtl"
      className="relative flex h-[100dvh] flex-col overflow-hidden"
      style={appHeight ? { height: `${appHeight}px` } : undefined}>
      <header className="sticky top-0 z-20 border-b border-border/50 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-2.5">
            <BreathMark className="size-6 shrink-0 text-primary" />
            <div className="flex items-baseline gap-2.5">
              <h1 className="font-display text-[1.2rem] font-medium tracking-[0.01em] text-foreground">
                מרחב
              </h1>
              <span className="hidden text-[0.75rem] tracking-wide text-muted-foreground sm:inline">
                שיחה שממשיכה
              </span>
            </div>
          </div>

          {knowsUser && !needsWelcome ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowJourney(true)}
              className="h-8 gap-1.5 px-2.5 text-[0.8rem] text-muted-foreground transition-transform duration-150 hover:text-foreground active:scale-[0.97]">
              <Route className="size-3.5" aria-hidden />
              המסע שלך
            </Button>
          ) : null}
        </div>
      </header>

      <main className="merhav-scroll relative z-10 flex-1 overflow-y-auto">
        <div
          className={[
            "mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 sm:px-6",
            hasConversation
              ? "py-8 sm:py-10"
              : "min-h-full justify-center py-10 sm:py-12",
          ].join(" ")}>
          {!hasConversation ? (
            needsWelcome ? (
              <WelcomeForm onDone={saveProfile} />
            ) : (
            <section className="merhav-fade relative flex flex-col gap-9">
              <div className="merhav-candle-glow" aria-hidden />

              <BreathMark
                animate
                className="relative size-14 text-primary/85 sm:size-16"
              />

              <div className="relative flex flex-col gap-5">
                <div className="font-display text-[1.7rem] font-normal leading-[1.5] tracking-[-0.005em] text-foreground sm:text-[2.05rem]">
                  {knowsUser ? (
                    <>
                      <p>
                        {profile.name
                          ? `טוב לראות אותך שוב, ${profile.name}.`
                          : "טוב לראות אותך שוב."}
                      </p>
                      <p className="mt-3 font-sans text-[1.05rem] font-light leading-[1.75] text-foreground/85 sm:text-[1.2rem]">
                        {journey.memory.lastFocus
                          ? `בפעם הקודמת דיברנו על ${journey.memory.lastFocus} — נמשיך מכאן, או מאיפה שבא לך.`
                          : "נמשיך מאיפה שהפסקנו, או מכל מקום אחר."}
                      </p>
                    </>
                  ) : (
                    <>
                      <p>
                        {profile.name ? `נעים להכיר, ${profile.name}.` : "בוא נכיר."}
                      </p>
                      <p className="mt-3 font-sans text-[1.05rem] font-light leading-[1.75] text-foreground/85 sm:text-[1.2rem]">
                        אני רוצה לשמוע מה עובר עליך — לא כדי לתקן משהו, אלא כדי
                        להבין.
                      </p>
                    </>
                  )}
                </div>
                <p className="max-w-md text-[0.92rem] leading-[1.8] text-muted-foreground">
                  {knowsUser
                    ? "מה שדיברנו נשמר במכשיר שלך בלבד, כדי שלא נתחיל כל פעם מאפס."
                    : "בלי הרשמה ובלי שם. השיחה נשמרת במכשיר שלך בלבד, כדי שנוכל להמשיך בפעם הבאה."}
                </p>
              </div>

              <div className="relative flex flex-col gap-3">
                <p className="text-[0.78rem] tracking-wide text-muted-foreground/70">
                  או פשוט לגעת באחד מאלה
                </p>
                <div className="flex flex-wrap gap-2">
                  {CONVERSATION_STARTERS.map((starter, index) => (
                    <button
                      key={starter}
                      type="button"
                      onClick={() => submit(starter)}
                      style={{ animationDelay: `${index * 55}ms` }}
                      className="merhav-rise rounded-full border border-border bg-card/50 px-3.5 py-2 text-[0.84rem] text-muted-foreground transition-all duration-200 hover:border-primary/35 hover:bg-primary/[0.06] hover:text-foreground active:scale-[0.97]">
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            </section>
            )
          ) : (
            <section className="flex flex-col gap-6">
              {messages.map(message => (
                <div key={message.id} className="flex flex-col gap-6">
                  {message.sessionStart ? (
                    <div className="flex items-center gap-3 py-1">
                      <span className="h-px flex-1 bg-border" />
                      <span className="text-[0.72rem] tracking-wide text-muted-foreground/60">
                        שיחה חדשה
                      </span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  ) : null}

                  {message.role === "user" ? (
                    <div className="flex justify-start">
                      <div className="merhav-rise max-w-[85%] rounded-[1.25rem] rounded-br-md bg-secondary/80 px-4 py-3 text-[1rem] leading-relaxed text-secondary-foreground sm:max-w-[75%]">
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      <div className="merhav-fade merhav-prose max-w-[95%] text-foreground/95 sm:max-w-[85%]">
                        {message.content.length > 0 ? (
                          <StreamingText
                            content={message.content}
                            chunkStart={message.lastChunkStart}
                          />
                        ) : (
                          <span className="flex items-center gap-1.5 py-1">
                            {[0, 1, 2].map(dot => (
                              <span
                                key={dot}
                                className="merhav-breathe size-1.5 rounded-full bg-primary/70"
                                style={{ animationDelay: `${dot * 220}ms` }}
                              />
                            ))}
                          </span>
                        )}
                      </div>

                      {message.safety === "acute" &&
                      message.content.length > 0 ? (
                        <HelplinesCard />
                      ) : null}
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}

          {hasConversation &&
          !isStreaming &&
          messages.length > 0 &&
          messages[messages.length - 1].role === "assistant" &&
          messages[messages.length - 1].isRecap ? (
            <div className="merhav-rise flex flex-col gap-3">
              <p className="text-[0.78rem] tracking-wide text-muted-foreground/70">
                או פשוט לגעת באחד מאלה
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  ...(contextualStarters.length > 0
                    ? contextualStarters
                    : CONVERSATION_STARTERS),
                  "בוא נשנה נושא רגע",
                ].map((starter, index) => (
                    <button
                      key={starter}
                      type="button"
                      onClick={() => submit(starter)}
                      style={{ animationDelay: `${index * 55}ms` }}
                      className="merhav-rise rounded-full border border-border bg-card/50 px-3.5 py-2 text-[0.84rem] text-muted-foreground transition-all duration-200 hover:border-primary/35 hover:bg-primary/[0.06] hover:text-foreground active:scale-[0.97]">
                      {starter}
                    </button>
                  )
                )}
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="merhav-rise flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 text-[0.85rem] text-muted-foreground">
              <p>{error}</p>
              {lastFailedMessage ? (
                <button
                  type="button"
                  onClick={retryLast}
                  disabled={isStreaming}
                  className="shrink-0 rounded-full border border-border px-3.5 py-1.5 text-[0.8rem] text-foreground transition-all duration-150 hover:border-primary/35 hover:bg-primary/[0.06] active:scale-[0.97] disabled:opacity-40">
                  לנסות שוב
                </button>
              ) : null}
            </div>
          ) : null}

          <div ref={bottomRef} className="h-1" />
        </div>
      </main>

      {needsWelcome ? null : (
      <footer className="relative z-10 border-t border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-2.5 px-4 pb-3.5 pt-3.5 sm:px-6">
          <div className="flex items-end gap-2 rounded-[1.35rem] border border-border bg-card/70 py-2 pe-2 ps-4 transition-colors duration-200 focus-within:border-primary/35">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              maxLength={MAX_MESSAGE_LENGTH}
              dir="rtl"
              aria-label="ההודעה שלך"
              placeholder={
                isReturningVisit ? "מה קרה מאז?" : "כתוב מה שבא"
              }
              className="merhav-scroll max-h-44 flex-1 resize-none bg-transparent py-2 text-[1rem] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60"
            />

            {isStreaming ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={stop}
                aria-label="עצור"
                className="size-9 shrink-0 rounded-full text-muted-foreground transition-transform duration-150 hover:text-foreground active:scale-[0.97]">
                <Square className="size-3.5 fill-current" aria-hidden />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                onClick={() => submit(draft)}
                disabled={draft.trim().length === 0}
                aria-label="שלח"
                className="size-9 shrink-0 rounded-full transition-transform duration-150 active:scale-[0.97] disabled:opacity-40">
                <ArrowUp className="size-4" aria-hidden />
              </Button>
            )}
          </div>

          <Disclaimer />
        </div>
      </footer>
      )}

      {showJourney ? (
        <JourneyPanel
          journey={journey}
          profile={profile}
          onClose={() => setShowJourney(false)}
          onForget={handleForget}
        />
      ) : null}
    </div>
  );
}
