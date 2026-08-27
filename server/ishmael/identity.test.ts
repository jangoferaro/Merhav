import { describe, expect, it } from "vitest";
import { EMPTY_IDENTITY, type Identity } from "../../shared/ishmael";
import {
  buildIdentityContext,
  mergeIdentity,
  missingField,
  normalizeIdentity,
} from "./identity";

describe("normalizeIdentity", () => {
  it("מחזיר זהות ריקה לקלט לא תקין", () => {
    expect(normalizeIdentity(null)).toEqual(EMPTY_IDENTITY);
    expect(normalizeIdentity("טל")).toEqual(EMPTY_IDENTITY);
  });

  it("דוחה מין שאינו זכר או נקבה", () => {
    expect(normalizeIdentity({ gender: "other" }).gender).toBe("");
  });

  it("דוחה גיל מחוץ לטווח סביר", () => {
    expect(normalizeIdentity({ age: 3 }).age).toBe(0);
    expect(normalizeIdentity({ age: 200 }).age).toBe(0);
    expect(normalizeIdentity({ age: 34 }).age).toBe(34);
  });

  it("חותך שם ארוך מדי", () => {
    expect(normalizeIdentity({ name: "א".repeat(90) }).name).toHaveLength(40);
  });
});

describe("mergeIdentity", () => {
  it("לא מוחק פרט שכבר ידוע כשמגיע עדכון חלקי", () => {
    const current: Identity = { name: "טל", gender: "male", age: 34 };
    expect(mergeIdentity(current, { age: 35 })).toEqual({
      name: "טל",
      gender: "male",
      age: 35,
    });
  });

  it("מתעלם מעדכון לא תקין ומשאיר את הקיים", () => {
    const current: Identity = { name: "טל", gender: "male", age: 34 };
    expect(mergeIdentity(current, { age: 1 } as Partial<Identity>).age).toBe(34);
  });
});

describe("missingField", () => {
  it("מברר לפי הסדר: שם, מין, גיל", () => {
    expect(missingField(EMPTY_IDENTITY)).toBe("name");
    expect(missingField({ name: "טל", gender: "", age: 0 })).toBe("gender");
    expect(missingField({ name: "טל", gender: "male", age: 0 })).toBe("age");
    expect(missingField({ name: "טל", gender: "male", age: 34 })).toBeNull();
  });
});

describe("buildIdentityContext", () => {
  it("בזהות חלקית — מנחה לשאול אחד בכל תור ולא לענות בחזרה", () => {
    const ctx = buildIdentityContext(EMPTY_IDENTITY);
    expect(ctx).toContain("שאל שאלה אחת בכל תור");
    expect(ctx).toContain("אל תענה עליה עדיין");
  });

  it("מנחה להסיק מין משם חד-משמעי במקום לשאול לחינם", () => {
    const ctx = buildIdentityContext({ name: "טל", gender: "", age: 0 });
    expect(ctx).toContain("הסק");
    expect(ctx).toContain("שמו: טל");
  });

  it("בזהות מלאה — כללי לשון לפי מין", () => {
    const male = buildIdentityContext({ name: "טל", gender: "male", age: 34 });
    expect(male).toContain("בלשון זכר");
    expect(male).not.toContain("בלשון נקבה בכל פועל");

    const female = buildIdentityContext({ name: "נועה", gender: "female", age: 34 });
    expect(female).toContain("בלשון נקבה");
  });

  it("רובד הלשון משתנה לפי גיל", () => {
    expect(buildIdentityContext({ name: "עידו", gender: "male", age: 12 })).toContain(
      "צעיר מאוד"
    );
    expect(buildIdentityContext({ name: "מרים", gender: "female", age: 72 })).toContain(
      "היה שם"
    );
  });
});
