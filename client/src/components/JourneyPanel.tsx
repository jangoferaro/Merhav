import { Compass, Sparkles, Target, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  GENDER_OPTIONS,
  hasProfileDetails,
  isMemoryEmpty,
  type JourneyState,
  type Profile,
} from "@shared/merhav";

type Props = {
  journey: JourneyState;
  profile: Profile;
  onClose: () => void;
  onForget: () => void;
};

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[0.75rem] tracking-wide text-muted-foreground/75">
        {title}
      </p>
      <ul className="flex flex-col gap-1.5">
        {items.map(item => (
          <li
            key={item}
            className="text-[0.92rem] leading-relaxed text-foreground/90">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * מסך "המסע שלי" — מראה לאדם את מה שנאסף עליו לאורך השיחות.
 * הדגש הוא על מה שיש בו, לא על מה שחסר.
 */
export default function JourneyPanel({
  journey,
  profile,
  onClose,
  onForget,
}: Props) {
  const { memory, sessionCount, startedAt } = journey;
  const empty = isMemoryEmpty(memory);

  const genderLabel =
    GENDER_OPTIONS.find(option => option.value === profile.gender)?.label ?? "";
  const profileLine = [
    profile.name,
    profile.age > 0 ? `${profile.age}` : "",
    genderLabel,
  ]
    .filter(part => part.length > 0)
    .join(" · ");

  const daysSince = Math.max(
    1,
    Math.round((Date.now() - startedAt) / (24 * 60 * 60 * 1000))
  );

  return (
    <div
      dir="rtl"
      className="merhav-fade fixed inset-0 z-50 flex items-end justify-center bg-background/70 backdrop-blur-md sm:items-center">
      <div className="merhav-rise merhav-scroll flex max-h-[85dvh] w-full max-w-xl flex-col overflow-y-auto rounded-t-[1.6rem] border border-border bg-card/95 p-6 sm:rounded-[1.6rem]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-[1.35rem] font-medium text-foreground">
              {profile.name ? `המסע של ${profile.name}` : "המסע שלך"}
            </h2>
            <p className="text-[0.8rem] text-muted-foreground">
              {sessionCount > 1
                ? `${sessionCount} שיחות, על פני ${daysSince} ימים`
                : "השיחה הראשונה שלך"}
            </p>
            {hasProfileDetails(profile) && profileLine ? (
              <p className="text-[0.75rem] text-muted-foreground/70">
                {profileLine}
              </p>
            ) : null}
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="סגור"
            className="size-8 shrink-0 rounded-full text-muted-foreground transition-transform duration-150 hover:text-foreground active:scale-[0.97]">
            <X className="size-4" aria-hidden />
          </Button>
        </div>

        {empty ? (
          <p className="mt-6 text-[0.95rem] leading-relaxed text-muted-foreground">
            כאן ייאסף מה שיעלה בשיחות — מה שחוזר אצלך, מה שגילית, ומה שהראית
            לעצמך שאתה מסוגל לו. עוד לא דיברנו מספיק כדי שיהיה מה לכתוב.
          </p>
        ) : (
          <div className="merhav-journal-page mt-6 flex flex-col gap-6 py-2">
            {memory.strengths.length > 0 ? (
              <div className="rounded-[1.1rem] border border-primary/25 bg-primary/[0.05] p-4">
                <p className="flex items-center gap-2 text-[0.8rem] tracking-wide text-primary/90">
                  <Sparkles className="size-3.5" aria-hidden />
                  מה שכבר עשית
                </p>
                <ul className="mt-2.5 flex flex-col gap-1.5">
                  {memory.strengths.map(item => (
                    <li
                      key={item}
                      className="text-[0.95rem] leading-relaxed text-foreground">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {memory.values.length > 0 ? (
              <div className="rounded-[1.1rem] border border-sage/30 bg-sage/[0.06] p-4">
                <p className="flex items-center gap-2 text-[0.8rem] tracking-wide text-sage">
                  <Compass className="size-3.5" aria-hidden />
                  מה שחשוב לך
                </p>
                <ul className="mt-2.5 flex flex-col gap-1.5">
                  {memory.values.map(item => (
                    <li
                      key={item}
                      className="text-[0.95rem] leading-relaxed text-foreground">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {memory.goals.length > 0 ? (
              <div className="rounded-[1.1rem] border border-coral/25 bg-coral/[0.06] p-4">
                <p className="flex items-center gap-2 text-[0.8rem] tracking-wide text-coral">
                  <Target className="size-3.5" aria-hidden />
                  לאן אתה רוצה להגיע
                </p>
                <ul className="mt-2.5 flex flex-col gap-1.5">
                  {memory.goals.map(item => (
                    <li
                      key={item}
                      className="text-[0.95rem] leading-relaxed text-foreground">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <Section title="מה שגילית על עצמך" items={memory.insights} />
            <Section title="רגשות שחוזרים אצלך" items={memory.emotions} />
            <Section title="דפוסים שחוזרים אצלך" items={memory.themes} />
            <Section title="מה שספרת על החיים שלך" items={memory.life} />

            {memory.practice ? (
              <div className="flex flex-col gap-2">
                <p className="text-[0.75rem] tracking-wide text-muted-foreground/75">
                  הדבר הקטן מהפעם הקודמת
                </p>
                <p className="text-[0.95rem] leading-relaxed text-foreground/90">
                  {memory.practice}
                </p>
              </div>
            ) : null}
          </div>
        )}

        <div className="mt-8 flex items-center justify-between gap-3 border-t border-border/70 pt-4">
          <p className="text-[0.72rem] leading-relaxed text-muted-foreground/70">
            הכול נשמר במכשיר הזה בלבד. לא בשרת ולא אצל אף אחד אחר.
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onForget}
            className="h-8 shrink-0 gap-1.5 px-2.5 text-[0.78rem] text-muted-foreground transition-transform duration-150 hover:text-destructive active:scale-[0.97]">
            <Trash2 className="size-3.5" aria-hidden />
            למחוק הכול
          </Button>
        </div>
      </div>
    </div>
  );
}
