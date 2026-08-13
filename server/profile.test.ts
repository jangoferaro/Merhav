import { describe, expect, it } from "vitest";
import { buildProfileContext, normalizeProfile } from "./profile";
import { buildMessages } from "./chatRoute";
import { EMPTY_PROFILE, isValidAge, isValidName } from "../shared/merhav";

describe("normalizeProfile", () => {
  it("מחזיר פרופיל ריק לקלט לא תקין", () => {
    expect(normalizeProfile(null)).toEqual(EMPTY_PROFILE);
    expect(normalizeProfile("דני")).toEqual(EMPTY_PROFILE);
  });

  it("מקבל פרופיל תקין", () => {
    const profile = normalizeProfile({
      name: "  דנה  ",
      age: 34,
      gender: "female",
      completed: true,
    });
    expect(profile).toEqual({
      name: "דנה",
      age: 34,
      gender: "female",
      completed: true,
    });
  });

  it("דוחה גיל מחוץ לטווח", () => {
    expect(normalizeProfile({ age: 3 }).age).toBe(0);
    expect(normalizeProfile({ age: 500 }).age).toBe(0);
    expect(normalizeProfile({ age: "לא מספר" }).age).toBe(0);
  });

  it("מקבל גיל שנשלח כמחרוזת", () => {
    expect(normalizeProfile({ age: "27" }).age).toBe(27);
  });

  it("דוחה מגדר לא מוכר", () => {
    expect(normalizeProfile({ gender: "משהו" }).gender).toBe("");
    expect(normalizeProfile({ gender: "male" }).gender).toBe("male");
  });

  it("חותך שם ארוך מדי", () => {
    const profile = normalizeProfile({ name: "א".repeat(100) });
    expect(profile.name.length).toBeLessThanOrEqual(24);
  });
});

describe("ולידציה משותפת", () => {
  it("שם תקין", () => {
    expect(isValidName("דנה")).toBe(true);
    expect(isValidName("   ")).toBe(false);
    expect(isValidName("א".repeat(30))).toBe(false);
  });

  it("גיל תקין", () => {
    expect(isValidAge(34)).toBe(true);
    expect(isValidAge(11)).toBe(false);
    expect(isValidAge(34.5)).toBe(false);
  });
});

describe("buildProfileContext", () => {
  it("מחזיר null כשאין שום פרט", () => {
    expect(buildProfileContext(EMPTY_PROFILE)).toBeNull();
    expect(
      buildProfileContext({ ...EMPTY_PROFILE, completed: true })
    ).toBeNull();
  });

  it("כולל את השם ומורה לא להשתמש בו בכל הודעה", () => {
    const context = buildProfileContext({
      ...EMPTY_PROFILE,
      name: "דנה",
      completed: true,
    });
    expect(context).toContain("דנה");
    expect(context).toContain("לא בכל הודעה");
  });

  it("מנחה ללשון נקבה", () => {
    const context = buildProfileContext({
      ...EMPTY_PROFILE,
      gender: "female",
      completed: true,
    });
    expect(context).toContain("לשון נקבה");
  });

  it("מנחה ללשון זכר", () => {
    const context = buildProfileContext({
      ...EMPTY_PROFILE,
      gender: "male",
      completed: true,
    });
    expect(context).toContain("לשון זכר");
  });

  it("מנחה לניסוח ניטרלי כשנבחר אחר", () => {
    const context = buildProfileContext({
      ...EMPTY_PROFILE,
      gender: "other",
      completed: true,
    });
    expect(context).toContain("ניטרליים");
  });

  it("מתאים את השפה לגיל צעיר", () => {
    const context = buildProfileContext({
      ...EMPTY_PROFILE,
      age: 15,
      completed: true,
    });
    expect(context).toContain("בית ספר");
  });

  it("מתאים את השפה לגיל מבוגר", () => {
    const context = buildProfileContext({
      ...EMPTY_PROFILE,
      age: 68,
      completed: true,
    });
    expect(context).toContain("בכבוד ובנחת");
  });
});

describe("buildMessages עם פרופיל", () => {
  it("מזריק את הפרופיל כהודעת מערכת לפני השיחה", () => {
    const profileContext = buildProfileContext({
      name: "דנה",
      age: 34,
      gender: "female",
      completed: true,
    });

    const messages = buildMessages([], "שלום", "none", null, profileContext);

    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("system");
    expect(String(messages[1].content)).toContain("דנה");
    expect(messages[messages.length - 1].content).toBe("שלום");
  });

  it("לא מוסיף הודעת מערכת כשאין פרופיל", () => {
    const messages = buildMessages([], "שלום", "none", null, null);
    const systemCount = messages.filter(m => m.role === "system").length;
    expect(systemCount).toBe(1);
  });
});
