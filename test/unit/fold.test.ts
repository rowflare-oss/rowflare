import { describe, expect, it } from "vitest";
import { foldSql, foldText } from "../../src/worker/base/query";

describe("foldSql", () => {
  it("adds a replace only for non-ASCII letters of the needle", () => {
    expect(foldSql("x", "abc")).toBe("lower(x)");
    expect(foldSql("x", "Öster")).toBe("lower(replace(x, 'Ö', 'ö'))");
    expect(foldSql("x", "åäö")).toBe("lower(replace(replace(replace(x, 'Å', 'å'), 'Ä', 'ä'), 'Ö', 'ö'))");
    expect(foldSql("x", "öÖö")).toBe("lower(replace(x, 'Ö', 'ö'))");
  });

  it("never inlines quotes, digits or symbols", () => {
    expect(foldSql("x", "' OR 1=1 --")).toBe("lower(x)");
    expect(foldSql("x", "ß€’")).toBe("lower(x)");
  });

  it("composes decomposed needles first", () => {
    expect(foldText("Ö")).toBe("ö");
    expect(foldSql("x", "Ö")).toBe("lower(replace(x, 'Ö', 'ö'))");
  });
});
