import { describe, expect, it } from "vitest";
import { repoRelativePath } from "../src/repo/paths.js";

describe("repoRelativePath", () => {
  it.each([
    ["src/a.ts", "src/a.ts"],
    ["./src/a.ts", "src/a.ts"],
    ["src/../lib/b.ts", "lib/b.ts"],
    ["..notes.md", "..notes.md"],
    ["src/..hidden/c.ts", "src/..hidden/c.ts"],
  ])("%s is inside the repo", (input, expected) => {
    expect(repoRelativePath(input)).toBe(expected);
  });

  it.each(["", ".", "..", "../x.ts", "src/../../x.ts", "/etc/passwd", "a/../.."])(
    "%j is not a file inside the repo",
    (input) => {
      expect(repoRelativePath(input)).toBeUndefined();
    },
  );
});
