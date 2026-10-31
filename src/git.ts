import { execFile } from "node:child_process";

export interface GitResult {
  code: number;
  stdout: string;
}

// 失敗（終了コードが 0 以外、git が無い）は例外にせず code で返す。判定の分岐に使うため。
// --literal-pathspecs: コードの行から来たパスを、git のパス指定の記法として解釈させない。
export interface GitOptions {
  /** パスを glob として解釈する。設定のパターンを渡すときだけ使い、コードの行のパスには使わない。 */
  globPathspecs?: boolean;
}

export function git(repo: string, args: string[], options: GitOptions = {}): Promise<GitResult> {
  const pathspecs = options.globPathspecs ? "--glob-pathspecs" : "--literal-pathspecs";
  return new Promise((resolve) => {
    execFile(
      "git",
      [pathspecs, "-C", repo, ...args],
      { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, LC_ALL: "C" } },
      (error, stdout) => {
        if (!error) return resolve({ code: 0, stdout });
        const code = typeof error.code === "number" ? error.code : 127;
        resolve({ code, stdout });
      },
    );
  });
}
