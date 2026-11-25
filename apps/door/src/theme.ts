// צבעי המותג והגופנים. האפליקציה כהה תמיד: עובדים בה בחושך, ליד דלת.
export const C = {
  ink: "#151515",
  paper: "#EDECE4",
  acid: "#DFFF45",
  red: "#FF493D",
  card: "#1C1C1A",
  raised: "#232321",
  line: "#3A3A36",
  camera: "#0C0C0B",
  muted: "#B9B8B0", // 8.9:1 על הרקע
  faint: "#9C9B94", // 6.4:1 על הרקע
};

export const F = {
  display: "Heebo_800ExtraBold",
  title: "Heebo_500Medium",
  body: "Assistant_400Regular",
  bodyBold: "Assistant_600SemiBold",
  mono: "IBMPlexMono_500Medium",
  brand: "SpaceGrotesk_700Bold",
};

// האפליקציה כתובה בעברית. הכיוון נקבע כאן במפורש, כך שהמסך נראה אותו דבר בכל שפת מכשיר.
export const rtl = { textAlign: "right" as const, writingDirection: "rtl" as const };
export const row = { flexDirection: "row-reverse" as const, alignItems: "center" as const };
