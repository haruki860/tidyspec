import { stat } from "node:fs/promises";
import path from "node:path";
import { git } from "./git.js";
import { repoRelativePath } from "./paths.js";

export type FileState =
  | "aligned"
  | "stale"
  | "working-changes"
  | "untracked"
  | "missing"
  | "unchecked";

export type ScreenStatus =
  | "aligned"
  | "stale"
  | "working-changes"
  | "missing"
  | "unknown"
  | "no-git";

export interface FileReport {
  path: string;
  state: FileState;
}

export interface ScreenReport {
  status: ScreenStatus;
  files: FileReport[];
}

export interface CheckOptions {
  /** リポジトリのルート */
  repo: string;
  /** 画面の Markdown。repo からの相対パス */
  screen: string;
  /** 画面の「コード」が指すファイル。repo からの相対パス */
  code: string[];
}

/** 画面の「コード」が指す各ファイルが、画面の Markdown より新しいかを git の履歴から決める。画面ファイルが無いのは呼び出し側のバグなので投げる。 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: TODO(decision 001): split or simplify in the refactor PRs; remove when fixed
export async function checkStaleness(options: CheckOptions): Promise<ScreenReport> {
  const { repo, screen } = options;
  if (!(await exists(repo, screen))) throw new Error(`screen file not found: ${screen}`);

  const present = await Promise.all(
    options.code.map(async (file) => ({ file, found: await exists(repo, file) })),
  );
  const anyMissing = present.some((entry) => !entry.found);

  const inside = await git(repo, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0) return unchecked(present, anyMissing ? "missing" : "no-git");

  // 浅い clone は「最後に変えたコミット」が境界のコミットになり、前後関係が信用できない。
  const shallow = await git(repo, ["rev-parse", "--is-shallow-repository"]);
  if (shallow.stdout.trim() === "true")
    return unchecked(present, anyMissing ? "missing" : "unknown");

  // 画面の Markdown に未コミットの変更（新規含む）があるときは、今まさに書かれている。
  // 全ての実装より新しいものとして扱う。
  const specDirty = (await porcelain(repo, screen)) !== "";
  const specCommit = await lastCommit(repo, screen);
  const ancestry = new Map<string, boolean>();

  const files: FileReport[] = [];
  for (const { file, found } of present) {
    if (!found) {
      files.push({ path: file, state: "missing" });
      continue;
    }
    const status = await porcelain(repo, file);
    if (status.startsWith("??")) {
      files.push({ path: file, state: "untracked" });
    } else if (specDirty) {
      files.push({ path: file, state: "aligned" });
    } else if (status !== "") {
      files.push({ path: file, state: "working-changes" });
    } else {
      const fileCommit = await lastCommit(repo, file);
      if (fileCommit === undefined) {
        files.push({ path: file, state: "untracked" });
      } else if (specCommit === undefined) {
        files.push({ path: file, state: "unchecked" });
      } else {
        const aligned =
          fileCommit === specCommit || (await isAncestor(repo, fileCommit, specCommit, ancestry));
        files.push({ path: file, state: aligned ? "aligned" : "stale" });
      }
    }
  }
  return { status: summarize(files), files };
}

function summarize(files: FileReport[]): ScreenStatus {
  if (files.some((f) => f.state === "missing")) return "missing";
  if (files.some((f) => f.state === "stale")) return "stale";
  if (files.some((f) => f.state === "working-changes")) return "working-changes";
  return "aligned";
}

function unchecked(
  present: { file: string; found: boolean }[],
  status: ScreenStatus,
): ScreenReport {
  return {
    status,
    files: present.map(({ file, found }) => ({
      path: file,
      state: found ? "unchecked" : "missing",
    })),
  };
}

// repo の外を指すパスは、無いものとして扱う（コードの行は信用しない）。
async function exists(repo: string, file: string): Promise<boolean> {
  const relative = repoRelativePath(file);
  if (relative === undefined) return false;
  try {
    return (await stat(path.join(repo, relative))).isFile();
  } catch {
    return false;
  }
}

// 失敗を「変更なし」と読むと、壊れた状態を揃っていると言ってしまう。
async function porcelain(repo: string, file: string): Promise<string> {
  const result = await git(repo, ["status", "--porcelain", "--", file]);
  if (result.code !== 0) throw new Error(`git status failed (exit ${result.code})`);
  return result.stdout.trim();
}

// 改名のコミットは、そのファイルを変えたコミットとして数える。
async function lastCommit(repo: string, file: string): Promise<string | undefined> {
  const result = await git(repo, ["log", "-1", "--format=%H", "--", file]);
  const hash = result.stdout.trim();
  return result.code === 0 && hash !== "" ? hash : undefined;
}

// biome-ignore lint/complexity/useMaxParams: TODO(decision 001): split or simplify in the refactor PRs; remove when fixed
async function isAncestor(
  repo: string,
  ancestor: string,
  descendant: string,
  cache: Map<string, boolean>,
): Promise<boolean> {
  const key = `${ancestor}:${descendant}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const result = await git(repo, ["merge-base", "--is-ancestor", ancestor, descendant]);
  // 終了コード 1 は「祖先ではない」。それ以外は git の失敗。
  if (result.code !== 0 && result.code !== 1)
    throw new Error(`git merge-base failed (exit ${result.code})`);
  cache.set(key, result.code === 0);
  return result.code === 0;
}
