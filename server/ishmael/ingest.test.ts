import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findExcerpts, loadGrounding, renderGrounding, resetGroundingCache } from "./ingest";

/**
 * הבדיקות משתמשות בטקסט שנכתב כאן במיוחד — הרפוזיטורי לא מכיל
 * ולא יכיל טקסט מספרים מוגנים.
 */
function withCorpus(files: Record<string, string>, fn: () => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ishmael-corpus-"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, "utf8");
  }
  process.env.ISHMAEL_CORPUS_DIR = dir;
  resetGroundingCache();
  try {
    fn();
  } finally {
    delete process.env.ISHMAEL_CORPUS_DIR;
    resetGroundingCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

afterEach(() => {
  delete process.env.ISHMAEL_CORPUS_DIR;
  resetGroundingCache();
});

describe("loadGrounding", () => {
  it("מחזיר רשימה ריקה כשאין תיקיית קורפוס — המצב הרגיל של הרפו", () => {
    process.env.ISHMAEL_CORPUS_DIR = path.join(os.tmpdir(), "no-such-dir-ishmael");
    resetGroundingCache();
    expect(loadGrounding()).toEqual([]);
  });

  it("טוען קבצי txt ומחלק לקטעים", () => {
    withCorpus({ "notes.txt": "חקלאות ותרבות. ".repeat(200) }, () => {
      const docs = loadGrounding();
      expect(docs).toHaveLength(1);
      expect(docs[0].title).toBe("notes");
      expect(docs[0].chunks.length).toBeGreaterThan(1);
    });
  });

  it("מתעלם מקבצים שאינם txt", () => {
    withCorpus({ "a.pdf": "בינגו", "b.txt": "טקסט" }, () => {
      expect(loadGrounding().map(d => d.title)).toEqual(["b"]);
    });
  });
});

describe("findExcerpts", () => {
  it("מוצא קטע לפי חפיפת מילים ומדווח מיקום יחסי", () => {
    withCorpus({ "notes.txt": "הערות על מרוץ המזון והאוכלוסייה בעולם." }, () => {
      const hits = findExcerpts(loadGrounding(), "מרוץ המזון והאוכלוסייה");
      expect(hits).toHaveLength(1);
      expect(hits[0].title).toBe("notes");
      expect(hits[0].position).toBe(0);
    });
  });

  it("דורש חפיפה של יותר ממילה אחת", () => {
    withCorpus({ "notes.txt": "הערות על מרוץ המזון." }, () => {
      expect(findExcerpts(loadGrounding(), "אבטיח")).toEqual([]);
    });
  });
});

describe("renderGrounding", () => {
  it("מחזיר null כשאין קורפוס", () => {
    expect(renderGrounding([], "שאלה כלשהי")).toBeNull();
  });

  it("מגביל את אורך הקטע ומורה לנסח מחדש", () => {
    withCorpus({ "notes.txt": "מרוץ המזון והאוכלוסייה. ".repeat(100) }, () => {
      const text = renderGrounding(loadGrounding(), "מרוץ המזון והאוכלוסייה")!;
      expect(text).toContain("אל תצטט יותר ממשפט קצר");
      // כל קטע חסום ב-320 תווים; שלושה קטעים לכל היותר
      const excerptBlocks = text.split("— notes,").length - 1;
      expect(excerptBlocks).toBeLessThanOrEqual(3);
      expect(text.length).toBeLessThan(1600);
    });
  });
});
