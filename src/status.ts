import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.js";
import { git } from "./git.js";
import { type Problem, parseScreen } from "./parse.js";
import { checkStaleness, type ScreenReport } from "./staleness.js";

export interface ScreenStatusReport {
  screen: string;
  problems: Problem[];
  staleness: ScreenReport;
}

/** 作業ツリーにある全ての画面について、形の問題と古さを調べる。git の中でだけ動く。 */
export async function checkAllScreens(repo: string, config: Config): Promise<ScreenStatusReport[]> {
  // 追跡中のものと、まだ追跡していない新しい画面の両方。
  const listed = await git(
    repo,
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...config.screens],
    { globPathspecs: true },
  );
  if (listed.code !== 0) throw new Error(`git ls-files failed (exit ${listed.code})`);
  const screens = [...new Set(listed.stdout.split("\0").filter((name) => name !== ""))].sort();

  const reports: ScreenStatusReport[] = [];
  for (const screen of screens) {
    const source = await readRegularFile(path.join(repo, screen));
    if (source === undefined) continue;
    const { screen: parsed, problems } = parseScreen(source, {
      maxLineLength: config.maxLineLength,
      language: config.language,
    });
    const staleness = await checkStaleness({
      repo,
      screen,
      code: parsed.code.map((entry) => entry.path),
    });
    reports.push({ screen, problems, staleness });
  }
  return reports;
}

// シンボリックリンクは読まない。repo の外のファイルの中身を、画面として表示させないため。
async function readRegularFile(file: string): Promise<string | undefined> {
  try {
    if (!(await lstat(file)).isFile()) return undefined;
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}
