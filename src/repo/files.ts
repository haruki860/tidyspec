import { lstat, readFile } from "node:fs/promises";
import { git } from "./git.js";

/** 1 ファイルの読み取りの上限。画面の Markdown や SQL にこれ以上の大きさは想定しない */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * 設定の glob に合う、追跡中のものと、まだ追跡していない（無視されていない）ファイルを、名前順で返す。
 * git の失敗は「ファイルが無い」と区別するため、例外にする。
 */
export async function listProjectFiles(repo: string, patterns: string[]): Promise<string[]> {
  const listed = await git(
    repo,
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...patterns],
    { globPathspecs: true },
  );
  if (listed.code !== 0) throw new Error(`git ls-files failed (exit ${listed.code})`);
  return [...new Set(listed.stdout.split("\0").filter((name) => name !== ""))].sort();
}

/**
 * 普通のファイルだけを読む。シンボリックリンクは読まない（repo の外のファイルの中身を、表示させないため）。
 * 大きすぎるものも読まない。
 */
export async function readRegularFile(file: string): Promise<string | undefined> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return undefined;
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}
