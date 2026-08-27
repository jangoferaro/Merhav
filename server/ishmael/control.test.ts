import { describe, expect, it } from "vitest";
import { createControlParser, parseControlLine } from "./control";

/** מזרים טקסט ברסיסים בגודל נתון, כמו שהוא באמת מגיע מהמודל. */
function stream(text: string, chunkSize: number) {
  const parser = createControlParser();
  let out = "";
  for (let i = 0; i < text.length; i += chunkSize) {
    const { text: piece } = parser.push(text.slice(i, i + chunkSize));
    out += piece;
  }
  out += parser.flush();
  return { control: parser.control, text: out };
}

describe("parseControlLine", () => {
  it("קורא טון ופרטי זהות", () => {
    const c = parseControlLine("tone:curious|reveal:hold|name:טל|gender:male|age:34");
    expect(c).toEqual({
      tone: "curious",
      revealRequested: false,
      name: "טל",
      gender: "male",
      age: 34,
    });
  });

  it("דוחה טון שאינו ברשימה", () => {
    expect(parseControlLine("tone:furious").tone).toBeUndefined();
  });

  it("דוחה מין שאינו male/female", () => {
    expect(parseControlLine("gender:other").gender).toBeUndefined();
  });

  it("דוחה גיל מחוץ לטווח", () => {
    expect(parseControlLine("age:2").age).toBeUndefined();
    expect(parseControlLine("age:abc").age).toBeUndefined();
  });

  it("דוחה 'שם' שהוא בעצם משפט", () => {
    expect(parseControlLine("name:הוא לא אמר לי את השם שלו").name).toBeUndefined();
    expect(parseControlLine("name:טל כהן").name).toBe("טל כהן");
  });

  it("קורא מה שהאדם סיפר על עצמו", () => {
    const c = parseControlLine("tone:warm|note:עובד בהייטק ומרגיש חסר טעם");
    expect(c.note).toBe("עובד בהייטק ומרגיש חסר טעם");
  });

  it("חותך הערה ארוכה מדי", () => {
    expect(parseControlLine(`note:${"א".repeat(300)}`).note).toHaveLength(120);
  });

  it("reveal:now בלבד נחשב בקשה", () => {
    expect(parseControlLine("reveal:now").revealRequested).toBe(true);
    expect(parseControlLine("reveal:hold").revealRequested).toBe(false);
  });
});

describe("createControlParser", () => {
  const message = "⟦tone:grave|reveal:hold⟧\n\nאיך קוראים לך?";

  it("מפריד את שורת הבקרה מהטקסט", () => {
    const { control, text } = stream(message, 1000);
    expect(control?.tone).toBe("grave");
    expect(text).toBe("איך קוראים לך?");
  });

  it("עובד גם כשהשורה נחתכת בין רסיסים", () => {
    for (const size of [1, 2, 3, 5, 7, 13]) {
      const { control, text } = stream(message, size);
      expect(control?.tone, `chunk size ${size}`).toBe("grave");
      expect(text, `chunk size ${size}`).toBe("איך קוראים לך?");
    }
  });

  it("לא בולע תשובה שהגיעה בלי שורת בקרה", () => {
    const { control, text } = stream("היי. איך קוראים לך?", 4);
    expect(control).toBeNull();
    expect(text).toBe("היי. איך קוראים לך?");
  });

  it("משחרר הכל אם הסוגר לא מגיע — עדיף טקסט בלי טון מאשר בליעה", () => {
    const broken = "⟦tone:calm" + "א".repeat(400);
    const { text } = stream(broken, 50);
    expect(text).toContain("א".repeat(50));
    expect(text.length).toBeGreaterThan(300);
  });

  it("שומר על טקסט שמגיע אחרי הסוגר באותו רסיס", () => {
    const { text } = stream("⟦tone:calm⟧\n\nשלום", 1000);
    expect(text).toBe("שלום");
  });

  it("לא מתייחס לסוגריים שמופיעים באמצע התשובה", () => {
    const { control, text } = stream("שלום ⟦tone:calm⟧ עולם", 3);
    expect(control).toBeNull();
    expect(text).toBe("שלום ⟦tone:calm⟧ עולם");
  });
});
