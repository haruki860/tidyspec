import path from "node:path";

/**
 * A path written in a screen file, as a normalized repo-relative path with `/`
 * separators; `undefined` when it does not name a file inside the repo.
 *
 * Code lines are untrusted input, so this is the single place that decides
 * "inside the repo?". Absolute paths and anything that climbs out via `..` never match.
 */
export function repoRelativePath(file: string): string | undefined {
  const normalized = path.posix.normalize(file);
  if (normalized === "." || path.posix.isAbsolute(normalized)) return undefined;
  // Compare whole segments: a file named "..notes.md" is inside the repo.
  if (normalized === ".." || normalized.startsWith("../")) return undefined;
  return normalized;
}
