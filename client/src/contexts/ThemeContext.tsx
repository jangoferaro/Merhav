import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

type Theme = "dark" | "light";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * "מרחב" מעוצב בכוונה כפלטה כהה יחידה (ראו index.css — :root ו-.dark
 * מגדירים בדיוק אותם משתנים). ה-ThemeProvider עדיין קיים כדי שיהיה
 * אפשר להוסיף מצב בהיר בעתיד בלי לשנות רכיבים אחרים.
 */
export function ThemeProvider({
  children,
  defaultTheme = "dark",
}: {
  children: ReactNode;
  defaultTheme?: Theme;
}) {
  const [theme, setTheme] = useState<Theme>(defaultTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme חייב לרוץ בתוך ThemeProvider");
  return ctx;
}
