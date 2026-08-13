import { HELPLINES } from "@shared/merhav";
import { MessageCircle, Phone } from "lucide-react";

/**
 * מוצג רק כשהשיחה עצמה הגיעה לשם. לא רכיב קבוע בממשק,
 * ולא כפתור שממתין בכותרת — כדי שאף אחד לא ייתקל בו כתיוג.
 */
export default function HelplinesCard() {
  return (
    <div
      dir="rtl"
      className="merhav-rise rounded-[--radius] border border-primary/25 bg-primary/[0.05] p-5">
      <p className="text-[0.95rem] font-medium text-foreground">
        יש אנשים שזה בדיוק מה שהם עושים
      </p>
      <p className="mt-1.5 text-[0.85rem] leading-relaxed text-muted-foreground">
        שיחה אחת, אנונימית ובחינם, בכל שעה. לא צריך להסביר או להצטדק.
      </p>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {HELPLINES.map(line => (
          <li key={line.id}>
            <a
              href={line.href}
              target={line.kind === "phone" ? undefined : "_blank"}
              rel={line.kind === "phone" ? undefined : "noopener noreferrer"}
              className="group flex items-start gap-3 rounded-xl border border-border/70 bg-background/40 px-3.5 py-3 transition-colors duration-200 hover:border-primary/40 hover:bg-primary/[0.07] focus-visible:border-primary/50 focus-visible:outline-none">
              <span className="mt-0.5 text-primary/80 transition-transform duration-200 group-hover:scale-105">
                {line.kind === "phone" ? (
                  <Phone className="size-4" aria-hidden />
                ) : (
                  <MessageCircle className="size-4" aria-hidden />
                )}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="text-[0.9rem] font-medium text-foreground">
                    {line.name}
                  </span>
                  <span
                    className="text-[0.9rem] text-primary"
                    style={{ direction: "ltr", unicodeBidi: "embed" }}>
                    {line.detail}
                  </span>
                </span>
                <span className="text-[0.75rem] leading-snug text-muted-foreground">
                  {line.availability}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

