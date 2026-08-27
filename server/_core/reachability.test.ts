import { describe, expect, it } from "vitest";
import { probeModelApi } from "./reachability";

describe("probeModelApi", () => {
  it("מדווח על שלב ה-DNS כששם היעד לא נפתר", async () => {
    const result = await probeModelApi("https://no-such-host-xyz-merhav.invalid");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.stage).toBe("dns");
      expect(result.detail).toContain("ENOTFOUND");
    }
  }, 15_000);

  it("מחלץ את שם המארח מכתובת מלאה", async () => {
    const result = await probeModelApi("https://no-such-host-xyz-merhav.invalid/v1/messages");
    expect(result.host).toBe("no-such-host-xyz-merhav.invalid");
  }, 15_000);
});
