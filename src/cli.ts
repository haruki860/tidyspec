import { parseArgs } from "node:util";
import { loadConfig } from "./config.js";
import { git } from "./git.js";
import { checkCommit } from "./hook.js";
import { runInit } from "./initCommand.js";
import type { Io } from "./io.js";
import { isLanguage } from "./language.js";
import { renderCheck, renderStatus, statusExitCode } from "./render.js";
import { checkAllScreens } from "./status.js";

const USAGE = `Usage: tidyspec <command> [options]

Commands:
  init     Set up tidyspec.json, the agent instructions in AGENTS.md and a pre-commit hook (asks questions)
  check    Inspect what is staged for commit (for a commit hook)
  status   Check every screen for format problems and for code newer than the spec

Options:
  --json     Print the result as JSON

Options for init (without a terminal, pass --yes):
  --yes               Do not ask; use the options below or the defaults
  --lang <en|ja>      Language of headings and messages
  --screens-dir <d>   Directory for the screen files (default: docs/screens)
  --no-hook           Do not install the pre-commit hook
  --no-instructions   Do not write the agent instructions

Other options:
  --strict   For status, also fail when staleness cannot be determined (e.g. a shallow clone)
  -h, --help Show this message

Exit codes: 0 no problems / 1 problems found / 2 usage, config or git failure
`;

const OPTIONS = {
  json: { type: "boolean" },
  strict: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  yes: { type: "boolean" },
  lang: { type: "string" },
  "screens-dir": { type: "string" },
  "no-hook": { type: "boolean" },
  "no-instructions": { type: "boolean" },
} as const;

function readArguments(argv: string[]) {
  return parseArgs({ args: argv, allowPositionals: true, options: OPTIONS });
}

type ReadResult =
  | { ok: true; arguments: ReturnType<typeof readArguments> }
  | { ok: false; error: string };

// parseArgs は知らないオプションなどで例外を投げる。使い方の誤りは想定内の失敗なので、値として返す。
function tryReadArguments(argv: string[]): ReadResult {
  try {
    return { ok: true, arguments: readArguments(argv) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** コマンドを実行して終了コードを返す。出力は io に渡し、プロセスは終了させない。 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: TODO(decision 001): split or simplify in the refactor PRs; remove when fixed
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: TODO(decision 001): split or simplify in the refactor PRs; remove when fixed
export async function run(argv: string[], io: Io, cwd: string): Promise<number> {
  const read = tryReadArguments(argv);
  if (!read.ok) {
    io.err(`tidyspec: ${read.error}\n\n${USAGE}`);
    return 2;
  }
  const parsed = read.arguments;

  const { json = false, strict = false, help = false } = parsed.values;
  const [command, ...rest] = parsed.positionals;
  if (help) {
    io.out(USAGE);
    return 0;
  }
  if ((command !== "init" && command !== "check" && command !== "status") || rest.length > 0) {
    io.err(USAGE);
    return 2;
  }

  try {
    const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
    const root = top.stdout.trim();
    if (top.code !== 0 || root === "") {
      io.err("tidyspec: run this inside a git repository");
      return 2;
    }
    if (command === "init") {
      const lang = parsed.values.lang;
      if (lang !== undefined && !isLanguage(lang)) {
        io.err(`tidyspec: --lang must be en or ja, not ${JSON.stringify(lang)}`);
        return 2;
      }
      return await runInit(
        root,
        {
          yes: parsed.values.yes ?? false,
          // biome-ignore lint/style/noNestedTernary: TODO(decision 001): split or simplify in the refactor PRs; remove when fixed
          language: lang === undefined ? undefined : isLanguage(lang) ? lang : undefined,
          screensDir: parsed.values["screens-dir"],
          noHook: parsed.values["no-hook"] ?? false,
          noInstructions: parsed.values["no-instructions"] ?? false,
        },
        io,
      );
    }
    const loaded = await loadConfig(root);
    if (!loaded.ok) {
      io.err(`tidyspec: ${loaded.error}`);
      return 2;
    }

    if (command === "check") {
      const report = await checkCommit(root, loaded.config);
      const text = json
        ? JSON.stringify(report, null, 2)
        : renderCheck(report, loaded.config.language);
      if (report.ok) io.out(text);
      else io.err(text);
      return report.ok ? 0 : 1;
    }

    const reports = await checkAllScreens(root, loaded.config);
    io.out(json ? JSON.stringify(reports, null, 2) : renderStatus(reports, loaded.config.language));
    return statusExitCode(reports, strict);
  } catch (error) {
    // git の失敗など。検査できなかったのを「問題なし」にはしない。
    io.err(`tidyspec: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}
