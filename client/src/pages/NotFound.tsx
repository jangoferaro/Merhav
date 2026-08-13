import { Link } from "wouter";

export default function NotFound() {
  return (
    <div
      dir="rtl"
      className="relative flex min-h-[100dvh] flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="merhav-ambient" aria-hidden />
      <p className="relative z-10 text-[1.35rem] font-light text-foreground">
        אין כאן דף כזה
      </p>
      <p className="relative z-10 max-w-sm text-[0.9rem] leading-relaxed text-muted-foreground">
        אולי הקישור השתנה. ההתחלה תמיד פתוחה.
      </p>
      <Link
        href="/"
        className="relative z-10 rounded-full border border-border bg-card/60 px-5 py-2.5 text-[0.9rem] text-foreground transition-all duration-200 hover:border-primary/40 hover:bg-primary/[0.07] active:scale-[0.97]">
        חזרה למרחב
      </Link>
    </div>
  );
}
