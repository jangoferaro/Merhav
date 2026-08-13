import { useState } from "react";
import { DISCLAIMER } from "@shared/merhav";

/**
 * ההבהרה נגישה תמיד, אבל אינה תופסת מקום על המסך.
 * שורה אחת דקה שנפתחת במגע — כדי שהכניסה לא תתחיל באזהרה.
 */
export default function Disclaimer() {
  const [open, setOpen] = useState(false);

  return (
    <div dir="rtl" className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="text-[0.7rem] text-muted-foreground/55 transition-colors duration-200 hover:text-muted-foreground">
        על המרחב הזה
      </button>

      {open ? (
        <p className="merhav-rise max-w-xl text-center text-[0.72rem] leading-relaxed text-muted-foreground/80">
          {DISCLAIMER}
        </p>
      ) : null}
    </div>
  );
}
