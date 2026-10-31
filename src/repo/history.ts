import { parseLastChange, type SpecChange } from "../core/diff.js";
import { git } from "./git.js";

/** 画面ファイルを最後に変えたコミットの、行の差分。履歴が無い（未コミット、git 管理外）ときは undefined。 */
export async function lastChange(repo: string, screen: string): Promise<SpecChange | undefined> {
  const result = await git(repo, [
    "log",
    "-1",
    "-p",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--format=%h%x00%cs%x00%s%x00",
    "--",
    screen,
  ]);
  return result.code === 0 ? parseLastChange(result.stdout) : undefined;
}
