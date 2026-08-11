import { describe, expect, it } from "vitest";
import { assessConversationSafety, assessSafety } from "./safety";

describe("assessSafety — מצוקה חריפה", () => {
  const acuteMessages = [
    "אני רוצה למות",
    "אני חושב להתאבד",
    "אני רוצה לשים סוף לחיים שלי",
    "אני פוגע בעצמי כשקשה",
    "אני רק רוצה להירדם ולא לקום",
    "אין טעם לחיות ככה",
    "כתבתי מכתב פרידה",
    "I want to kill myself",
  ];

  it.each(acuteMessages)("מזהה מצוקה חריפה: %s", message => {
    expect(assessSafety(message).level).toBe("acute");
  });

  it("שני סימנים הקשריים יחד נחשבים מצוקה חריפה", () => {
    const result = assessSafety(
      "אני על הקצה, אין לי אף אחד ואני לא יכול יותר"
    );
    expect(result.level).toBe("acute");
  });
});

describe("assessSafety — מצוקה מוגברת", () => {
  it("סימן הקשרי בודד מסומן כמוגבר ולא כחריף", () => {
    expect(assessSafety("אני מרגיש שאני אפס").level).toBe("elevated");
  });

  it("שלילה מפורשת מורידה מחריף למוגבר", () => {
    expect(assessSafety("אני לא חושב על להתאבד, רק עצוב").level).toBe(
      "elevated"
    );
  });
});

describe("assessSafety — ללא התראה", () => {
  const calmMessages = [
    "אני מרגיש עצוב היום",
    "היה לי יום מתיש בעבודה",
    "אני לא מצליח להירגע לפני השינה",
    "רבתי עם אחי ואני מוצף",
    "אני רוצה ללמוד לנשום יותר טוב",
    "כמה זמן כדאי לשבת בשקט",
    "",
  ];

  it.each(calmMessages)("לא מתריע על: %s", message => {
    expect(assessSafety(message).level).toBe("none");
  });
});

describe("assessConversationSafety", () => {
  it("מצוקה חריפה בהודעה קודמת משאירה את השיחה בכוננות", () => {
    const result = assessConversationSafety("אני עייף", [
      "אני חושב להתאבד",
    ]);
    expect(result.level).toBe("elevated");
  });

  it("סימן מוגבר עכשיו יחד עם חריף קודם הופך לחריף", () => {
    const result = assessConversationSafety("אני אפס", [
      "אני רוצה למות",
    ]);
    expect(result.level).toBe("acute");
  });

  it("שיחה רגועה נשארת נקייה", () => {
    const result = assessConversationSafety("מה זה בכלל מיינדפולנס", [
      "היה לי יום ארוך",
    ]);
    expect(result.level).toBe("none");
  });

  it("מצוקה חריפה בהודעה הנוכחית גוברת על הקשר רגוע", () => {
    const result = assessConversationSafety("אני רוצה למות", [
      "היה לי יום נחמד",
    ]);
    expect(result.level).toBe("acute");
  });
});
