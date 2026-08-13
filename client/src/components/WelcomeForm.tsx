import { useState } from "react";
import BreathMark from "@/components/BreathMark";
import Disclaimer from "@/components/Disclaimer";
import { Button } from "@/components/ui/button";
import {
  GENDER_OPTIONS,
  MAX_AGE,
  MAX_NAME_LENGTH,
  MIN_AGE,
  isValidAge,
  isValidName,
  type Gender,
  type Profile,
} from "@shared/merhav";

type Props = {
  onDone: (profile: Profile) => void;
};

/**
 * מסך ההיכרות. שלוש שאלות, אפשר לדלג על הכול.
 * הטון: מבקש להכיר, לא ממלא טופס.
 */
export default function WelcomeForm({ onDone }: Props) {
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [touched, setTouched] = useState(false);

  const ageNumber = Number.parseInt(age, 10);
  const ageProvided = age.trim().length > 0;
  const ageInvalid = ageProvided && !isValidAge(ageNumber);
  const nameInvalid = touched && name.trim().length > 0 && !isValidName(name);

  const submit = () => {
    setTouched(true);
    if (ageInvalid) return;

    onDone({
      name: isValidName(name) ? name.trim() : "",
      age: ageProvided && isValidAge(ageNumber) ? ageNumber : 0,
      gender,
      completed: true,
    });
  };

  const skip = () => {
    onDone({ name: "", age: 0, gender: "", completed: true });
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div
      dir="rtl"
      className="merhav-fade mx-auto flex w-full max-w-md flex-col gap-8">
      <BreathMark animate className="size-14 text-primary/85" />

      <div className="flex flex-col gap-3">
        <h2 className="font-display text-[1.7rem] font-normal leading-[1.5] text-foreground sm:text-[2rem]">
          לפני שנתחיל — איך לקרוא לך?
        </h2>
        <p className="text-[0.92rem] leading-[1.8] text-muted-foreground">
          שלוש שאלות קצרות, כדי שאדע איך לדבר איתך. הכול נשמר במכשיר שלך בלבד,
          ואפשר גם לדלג.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label
            htmlFor="merhav-name"
            className="text-[0.8rem] tracking-wide text-muted-foreground">
            השם שלך
          </label>
          <input
            id="merhav-name"
            value={name}
            onChange={event => setName(event.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={MAX_NAME_LENGTH}
            dir="rtl"
            autoComplete="off"
            placeholder="שם פרטי, או כל שם שתרצה"
            className="rounded-[1.1rem] border border-border bg-card/60 px-4 py-3 text-[1rem] text-foreground outline-none transition-colors duration-200 focus:border-primary/40 placeholder:text-muted-foreground/50"
          />
          {nameInvalid ? (
            <p className="text-[0.78rem] text-muted-foreground">
              שם עד {MAX_NAME_LENGTH} תווים.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor="merhav-age"
            className="text-[0.8rem] tracking-wide text-muted-foreground">
            הגיל שלך
          </label>
          <input
            id="merhav-age"
            value={age}
            onChange={event =>
              setAge(event.target.value.replace(/[^0-9]/g, "").slice(0, 3))
            }
            onKeyDown={handleKeyDown}
            inputMode="numeric"
            dir="rtl"
            autoComplete="off"
            placeholder="למשל 34"
            className="rounded-[1.1rem] border border-border bg-card/60 px-4 py-3 text-[1rem] text-foreground outline-none transition-colors duration-200 focus:border-primary/40 placeholder:text-muted-foreground/50"
          />
          {ageInvalid ? (
            <p className="text-[0.78rem] text-muted-foreground">
              גיל בין {MIN_AGE} ל-{MAX_AGE}.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2.5">
          <span className="text-[0.8rem] tracking-wide text-muted-foreground">
            כדי שאדבר איתך בלשון הנכונה
          </span>
          <div className="flex flex-wrap gap-2">
            {GENDER_OPTIONS.map(option => {
              const active = gender === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setGender(active ? "" : option.value)}
                  className={[
                    "rounded-full border px-4 py-2 text-[0.88rem] transition-all duration-200 active:scale-[0.97]",
                    active
                      ? "border-primary/50 bg-primary/[0.12] text-foreground"
                      : "border-border bg-card/50 text-muted-foreground hover:border-primary/30 hover:text-foreground",
                  ].join(" ")}>
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={submit}
          className="h-11 flex-1 rounded-full text-[0.95rem] transition-transform duration-150 active:scale-[0.97]">
          נעים להכיר
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={skip}
          className="h-11 rounded-full px-4 text-[0.88rem] text-muted-foreground transition-transform duration-150 hover:text-foreground active:scale-[0.97]">
          לדלג
        </Button>
      </div>

      <Disclaimer />
    </div>
  );
}
