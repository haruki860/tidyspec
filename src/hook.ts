import path from "node:path";
import { git } from "./git.js";
import { parseScreen, severityOf, type CodeEntry, type Problem } from "./parse.js";

export interface HookConfig {
  /** 画面の Markdown。git の glob 形式 */
  screens: string[];
  /** 実装ファイル。「未登録」を知らせるためだけに使い、止めるかどうかには関わらない */
  implementation: string[];
  maxLineLength?: number;
}

// 画面の置き場と実装のパターンは SPEC に無いので、仮の既定値。
export const DEFAULT_HOOK_CONFIG: HookConfig = {
  screens: ["docs/screens/**/*.md"],
  implementation: ["src/**", "app/**"],
};

export type Violation =
  | { kind: "screen-problem"; screen: string; problem: Problem }
  | { kind: "screen-unreadable"; screen: string }
  | { kind: "code-file-missing"; screen: string; line: number; path: string }
  | { kind: "spec-not-updated"; file: string; screens: string[] };

export interface HookReport {
  ok: boolean;
  violations: Violation[];
  warnings: { screen: string; problem: Problem }[];
  /** 変わった実装ファイルのうち、どの画面の「コード」にも載っていないもの */
  unregistered: string[];
}

/**
 * これからコミットされる内容（インデックス）を検査する。作業ツリーは見ない。
 * 文章の正しさは見ず、形と、コードの行の参照、実装を変えたのに仕様が動いていないことだけを見る。
 */
export async function checkCommit(
  repo: string,
  config: HookConfig = DEFAULT_HOOK_CONFIG,
): Promise<HookReport> {
  const changed = new Set(
    await listPaths(repo, ["diff", "--cached", "--name-only", "-z", "--no-renames"]),
  );
  const screenFiles = await listPaths(repo, ["ls-files", "-z", "--", ...config.screens], true);

  const violations: Violation[] = [];
  const warnings: HookReport["warnings"] = [];
  const listedBy = new Map<string, string[]>();

  for (const screen of screenFiles) {
    const source = await readIndexed(repo, screen);
    if (source === undefined) {
      if (changed.has(screen)) violations.push({ kind: "screen-unreadable", screen });
      continue;
    }
    const { screen: parsed, problems } = parseScreen(source, { maxLineLength: config.maxLineLength });
    for (const entry of parsed.code) {
      const key = normalize(entry.path);
      if (key !== undefined) listedBy.set(key, [...(listedBy.get(key) ?? []), screen]);
    }
    // 触っていない画面の崩れで、関係ないコミットを止めない。
    if (!changed.has(screen)) continue;
    for (const problem of problems) {
      if (severityOf(problem) === "error") violations.push({ kind: "screen-problem", screen, problem });
      else warnings.push({ screen, problem });
    }
    for (const entry of parsed.code) {
      if (!(await isIndexed(repo, entry))) {
        violations.push({ kind: "code-file-missing", screen, line: entry.line, path: entry.path });
      }
    }
  }

  const screenSet = new Set(screenFiles);
  for (const file of changed) {
    if (screenSet.has(file)) continue;
    const screens = listedBy.get(file) ?? [];
    // 載せている画面のうち、一つでも変わっていればよい。
    if (screens.length > 0 && !screens.some((screen) => changed.has(screen))) {
      violations.push({ kind: "spec-not-updated", file, screens });
    }
  }

  const implementation =
    config.implementation.length === 0
      ? []
      : await listPaths(
          repo,
          ["diff", "--cached", "--name-only", "-z", "--no-renames", "--", ...config.implementation],
          true,
        );
  const unregistered = implementation.filter((file) => !screenSet.has(file) && !listedBy.has(file));

  return { ok: violations.length === 0, violations, warnings, unregistered };
}

// コードの行は信用しない入力。repo の外や絶対パスは、どのファイルとも一致させない。
function normalize(file: string): string | undefined {
  const normalized = path.posix.normalize(file);
  if (normalized === "." || normalized.startsWith("..") || path.posix.isAbsolute(normalized)) return undefined;
  return normalized;
}

// git が失敗したのに「変更なし」として通すと、検査したことにならない。失敗は呼び出し側に伝える。
async function listPaths(repo: string, args: string[], globPathspecs = false): Promise<string[]> {
  const result = await git(repo, args, { globPathspecs });
  if (result.code !== 0) throw new Error(`git ${args[0] ?? ""} failed (exit ${result.code})`);
  return result.stdout.split("\0").filter((name) => name !== "");
}

// ファイル名を ref の記法（:path）に混ぜないよう、いったん blob のハッシュを引いてから読む。
async function readIndexed(repo: string, file: string): Promise<string | undefined> {
  const entry = await git(repo, ["ls-files", "-s", "-z", "--", file]);
  const hash = /^\d+ ([0-9a-f]+) 0\t/.exec(entry.stdout)?.[1];
  if (hash === undefined) return undefined;
  const blob = await git(repo, ["cat-file", "blob", hash]);
  return blob.code === 0 ? blob.stdout : undefined;
}

async function isIndexed(repo: string, entry: CodeEntry): Promise<boolean> {
  const file = normalize(entry.path);
  if (file === undefined) return false;
  return (await listPaths(repo, ["ls-files", "-z", "--", file])).includes(file);
}
