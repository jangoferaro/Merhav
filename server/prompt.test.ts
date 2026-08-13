import { describe, expect, it } from "vitest";
import {
  ACUTE_SAFETY_DIRECTIVE,
  ELEVATED_SAFETY_DIRECTIVE,
  SYSTEM_PROMPT,
} from "./prompt";
import { DISCLAIMER, HELPLINES } from "../shared/merhav";

describe("פרומפט המערכת", () => {
  it("מכיל את מספרי קווי הסיוע המדויקים", () => {
    expect(SYSTEM_PROMPT).toContain("1201");
    expect(SYSTEM_PROMPT).toContain("052-8451201");
    expect(SYSTEM_PROMPT).toContain('סה"ר');
    expect(SYSTEM_PROMPT).toContain("101");
  });

  it("מגדיר מסלול שיחה מתקדם", () => {
    expect(SYSTEM_PROMPT).toContain("תכיר אותו");
    expect(SYSTEM_PROMPT).toContain("תבין את הדפוס");
    expect(SYSTEM_PROMPT).toContain("תראה לו את מה שהוא לא רואה");
    expect(SYSTEM_PROMPT).toContain("משהו קטן לעשות");
  });

  it("אוסר על שאלות מופשטות שאינן מובילות לשום מקום", () => {
    expect(SYSTEM_PROMPT).toContain("שאלות אסורות");
    expect(SYSTEM_PROMPT).toContain("מי מבחין בזה");
    expect(SYSTEM_PROMPT).toContain("לא הבנתי את השאלה");
  });

  it("מנחה לשקף את הטוב על בסיס ראיות מחייו", () => {
    expect(SYSTEM_PROMPT).toContain("לגרום לו לראות את זה בעצמו");
    expect(SYSTEM_PROMPT).toContain("בלי להחמיא");
  });

  it("מגדיר את השיחה כמסע מתמשך", () => {
    expect(SYSTEM_PROMPT).toContain("זה לא שיחה אחת");
    expect(SYSTEM_PROMPT).toContain("מה שידוע עליו עד כה");
    expect(SYSTEM_PROMPT).toContain("אל תמציא");
  });

  it("ממקד בערך עצמי וביטחון", () => {
    expect(SYSTEM_PROMPT).toContain("להעלות את הערך העצמי");
    expect(SYSTEM_PROMPT).toContain("ביטחון");
  });

  it("שומר על יסוד המיינדפולנס בלי להפוך לתורה", () => {
    expect(SYSTEM_PROMPT).toContain("מיינדפולנס מעשי");
  });

  it("אוסר על אבחון ועל שינוי טיפול", () => {
    expect(SYSTEM_PROMPT).toContain("אינך מאבחן");
    expect(SYSTEM_PROMPT).toContain("טיפול תרופתי");
  });

  it("דורש עברית בלבד", () => {
    expect(SYSTEM_PROMPT).toContain("בעברית בלבד");
  });
});

describe("הנחיות הבטיחות", () => {
  it("ההנחיה החריפה עוצרת חקירה ומספקת את כל הכתובות", () => {
    expect(ACUTE_SAFETY_DIRECTIVE).toContain("עצור");
    expect(ACUTE_SAFETY_DIRECTIVE).toContain("1201");
    expect(ACUTE_SAFETY_DIRECTIVE).toContain("052-8451201");
    expect(ACUTE_SAFETY_DIRECTIVE).toContain('סה"ר');
    expect(ACUTE_SAFETY_DIRECTIVE).toContain("101");
  });

  it("ההנחיה החריפה אוסרת מסירת אמצעים", () => {
    expect(ACUTE_SAFETY_DIRECTIVE).toContain("אמצעים");
  });

  it("ההנחיה המוגברת מונעת חקירה", () => {
    expect(ELEVATED_SAFETY_DIRECTIVE).toContain("אל תזמין חקירה");
  });

  it("ההנחיה המוגברת אינה מציגה מספרי סיוע מוקדם מדי", () => {
    expect(ELEVATED_SAFETY_DIRECTIVE).not.toContain("1201");
    expect(ELEVATED_SAFETY_DIRECTIVE).toContain("אל תציע קווי סיוע");
  });

  it("ההנחיה החריפה שומרת על טון רגוע ובוטח", () => {
    expect(ACUTE_SAFETY_DIRECTIVE).toContain("בלי בהלה");
  });
});

describe("טון הקול", () => {
  it("הפרומפט אוסר על שפה של דאגה ומצוקה בממשק השיחה", () => {
    expect(SYSTEM_PROMPT).toContain("ביטחון שקט");
    expect(SYSTEM_PROMPT).toContain("אל תציע עזרה");
    expect(SYSTEM_PROMPT).toContain("אני מצטער לשמוע");
  });

  it("הפרומפט מתייחס למשתמש כאדם שלם ולא כשביר", () => {
    expect(SYSTEM_PROMPT).toContain("אדם שלם");
  });
});

describe("קבועים משותפים", () => {
  it("הדיסקליימר מצהיר שאין כאן טיפול או אבחון", () => {
    expect(DISCLAIMER).toContain("אינו טיפול");
    expect(DISCLAIMER).toContain("אינו מאבחן");
  });

  it("הדיסקליימר אינו פותח בשפה של מצוקה", () => {
    expect(DISCLAIMER).not.toContain("קשה לך");
    expect(DISCLAIMER).not.toContain("מצוקה");
  });

  it("רשימת קווי הסיוע כוללת ער\u05f4ן, סה\u05f4ר ומד\u05f4א", () => {
    const ids = HELPLINES.map(h => h.id);
    expect(ids).toContain("eran");
    expect(ids).toContain("eran-whatsapp");
    expect(ids).toContain("sahar");
    expect(ids).toContain("mda");
  });

  it("לכל קו סיוע יש קישור פעולה", () => {
    HELPLINES.forEach(line => {
      expect(line.href.length).toBeGreaterThan(0);
    });
  });
});
