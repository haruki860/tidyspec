import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { git } from "./git.js";
import { checkCommit } from "./hook.js";
import { renderCheck, renderStatus, statusExitCode } from "./render.js";
import { checkAllScreens } from "./status.js";

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

const USAGE = `使い方: tidyspec <コマンド> [オプション]

コマンド:
  check    これからコミットする内容（ステージしたもの）を検査する。コミットフック用
  status   全ての画面について、形の問題と、実装の方が新しいかを調べる

オプション:
  --json     結果を JSON で出す
  --strict   status で、古さを判定できない画面（浅い clone など）も失敗にする
  -h, --help このメッセージ

終了コード: 0 問題なし / 1 問題あり / 2 使い方や設定、git の失敗
`;

/** コマンドを実行して終了コードを返す。出力は io に渡し、プロセスは終了させない。 */
export async function run(argv: string[], io: Io, cwd: string): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: "boolean" },
        strict: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    io.err(`tidyspec: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }

  const { json = false, strict = false, help = false } = parsed.values;
  const [command, ...rest] = parsed.positionals;
  if (help) {
    io.out(USAGE);
    return 0;
  }
  if ((command !== "check" && command !== "status") || rest.length > 0) {
    io.err(USAGE);
    return 2;
  }

  try {
    const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
    const root = top.stdout.trim();
    if (top.code !== 0 || root === "") {
      io.err("tidyspec: git リポジトリの中で実行してください");
      return 2;
    }
    const loaded = await loadConfig(root);
    if (!loaded.ok) {
      io.err(`tidyspec: ${loaded.error}`);
      return 2;
    }

    if (command === "check") {
      const report = await checkCommit(root, loaded.config);
      const text = json ? JSON.stringify(report, null, 2) : renderCheck(report);
      if (report.ok) io.out(text);
      else io.err(text);
      return report.ok ? 0 : 1;
    }

    const reports = await checkAllScreens(root, loaded.config);
    io.out(json ? JSON.stringify(reports, null, 2) : renderStatus(reports));
    return statusExitCode(reports, strict);
  } catch (error) {
    // git の失敗など。検査できなかったのを「問題なし」にはしない。
    io.err(`tidyspec: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}
