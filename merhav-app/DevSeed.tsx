import { useEffect } from "react";
import {
  CONVERSATION_STORAGE_KEY,
  JOURNEY_STORAGE_KEY,
  NEW_SESSION_GAP_MS,
} from "@shared/merhav";

/**
 * דף פיתוח בלבד. מזריק מסע לדוגמה ל-localStorage כדי לאמת
 * ויזואלית את זרימת החזרה, המפריד ומסך המסע.
 */
export default function DevSeed() {
  useEffect(() => {
    const now = Date.now();

    window.localStorage.setItem(
      JOURNEY_STORAGE_KEY,
      JSON.stringify({
        memory: {
          life: [
            "מנהל צוות קטן בחברת תוכנה",
            "גר בתל אביב עם שותף",
            "רץ בבוקר כשמצליח לקום",
          ],
          themes: [
            "תחושת אי-עמידה בדדליינים חוזרת",
            "קול פנימי שאומר שהוא לא מספיק טוב",
          ],
          strengths: [
            "נשאר עד עשר בלילה שלושה ימים ברצף כדי לנסות לסיים",
            "לקח אחריות מול הצוות למרות שהיה לו קשה",
          ],
          insights: ['אמר לעצמי "אני לא מספיק טוב לתפקיד" ושמעתי את זה'],
          emotions: [
            "בושה כשהוא מרגיש שהוא מאכזב את הצוות",
            "חרדה בימים שלפני דדליין",
          ],
          values: [
            "אחריות כלפי האנשים שסומכים עליו",
            "רצון להיות מישהו שאפשר לסמוך עליו",
          ],
          goals: ["לסיים פרויקט אחד בלי לילות מאוחרים", "לרוץ 10 ק\"מ ברצף"],
          practice: "לרשום עד מחר דבר אחד אחד שכן הצליח היום",
          lastFocus: "הדדליין שלא עמדת בו ומה שאמרת לעצמך אחרי",
        },
        sessionCount: 3,
        lastVisitAt: now - NEW_SESSION_GAP_MS * 2,
        startedAt: now - 9 * 24 * 60 * 60 * 1000,
      })
    );

    // ?empty=1 — מסע קיים בלי שיחה פתוחה, לבדיקת מסך החזרה
    if (new URLSearchParams(window.location.search).has("empty")) {
      window.localStorage.removeItem(CONVERSATION_STORAGE_KEY);
      window.location.href = "/";
      return;
    }

    window.localStorage.setItem(
      CONVERSATION_STORAGE_KEY,
      JSON.stringify({
        messages: [
          {
            id: "a1",
            role: "user",
            content: "היה לי יום מבאס",
          },
          {
            id: "a2",
            role: "assistant",
            content: "מה קרה?",
          },
          {
            id: "a3",
            role: "user",
            content: "שוב לא עמדתי בדדליין בעבודה",
            sessionStart: false,
          },
          {
            id: "a4",
            role: "assistant",
            content:
              "שלושה לילות עד עשר — זה לא נשמע כמו מישהו שלא מספיק טוב.\n\nמה בדיוק לא הספקת?",
          },
          {
            id: "b1",
            role: "user",
            content: "חזרתי. עבר שבוע",
            sessionStart: true,
          },
          {
            id: "b2",
            role: "assistant",
            content:
              "טוב לראות אותך. בפעם הקודמת הצעתי לך לרשום דבר אחד שכן הצלחת — יצא לך?",
          },
        ],
      })
    );

    window.location.href = "/";
  }, []);

  return <p dir="rtl">מזריק מסע לדוגמה...</p>;
}
