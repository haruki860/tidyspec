import { parseArgs } from "node:util";
import { checkCommit } from "../checks/hook.js";
import { renderCheck, renderStatus, statusExitCode } from "../checks/render.js";
import { checkAllScreens } from "../checks/status.js";
import { type Config, loadConfig } from "../config.js";
import { isLanguage } from "../core/language.js";
import { git } from "../repo/git.js";
import { type InitFlags, runInit } from "./initCommand.js";
import type { Io } from "./io.js";
import { parsePort, runPreview } from "./previewCommand.js";

const USAGE = `Usage: tidyspec <command> [options]

Commands:
  init     Set up tidyspec.json, the agent instructions in AGENTS.md and a pre-commit hook (asks questions)
  check    Inspect what is staged for commit (for a commit hook)
  status   Check every screen for format problems and for code newer than the spec
  preview  Show the screens in the browser (a local page, read-only)

Options:
  --json     Print the result as JSON

Options for init (without a terminal, pass --yes):
  --yes               Do not ask; use the options below or the defaults
  --lang <en|ja>      Language of headings and messages
  --screens-dir <d>   Directory for the screen files (default: docs/screens)
  --no-hook           Do not install the pre-commit hook
  --no-instructions   Do not write the agent instructions

Options for preview:
  --port <n>          Port to listen on (default: 4321, 0 for any free port); only 127.0.0.1

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
  port: { type: "string" },
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

type Arguments = ReturnType<typeof readArguments>;
type Command = "init" | "check" | "status" | "preview";

function isCommand(value: string | undefined): value is Command {
  return value === "init" || value === "check" || value === "status" || value === "preview";
}

function fail(io: Io, message: string): number {
  io.err(`tidyspec: ${message}`);
  return 2;
}

type FlagsResult = { ok: true; flags: InitFlags } | { ok: false; error: string };

function initFlags(values: Arguments["values"]): FlagsResult {
  const lang = values.lang;
  if (lang !== undefined && !isLanguage(lang)) {
    return { ok: false, error: `--lang must be en or ja, not ${JSON.stringify(lang)}` };
  }
  const flags: InitFlags = {
    yes: values.yes ?? false,
    language: lang,
    screensDir: values["screens-dir"],
    noHook: values["no-hook"] ?? false,
    noInstructions: values["no-instructions"] ?? false,
  };
  return { ok: true, flags };
}

/** check と status が共有する、出力の形。 */
interface Output {
  io: Io;
  json: boolean;
}

async function runCheck(root: string, config: Config, output: Output): Promise<number> {
  const report = await checkCommit(root, config);
  const text = output.json ? JSON.stringify(report, null, 2) : renderCheck(report, config.language);
  if (report.ok) output.io.out(text);
  else output.io.err(text);
  return report.ok ? 0 : 1;
}

async function runStatus(
  root: string,
  config: Config,
  output: Output & { strict: boolean },
): Promise<number> {
  const reports = await checkAllScreens(root, config);
  const text = output.json
    ? JSON.stringify(reports, null, 2)
    : renderStatus(reports, config.language);
  output.io.out(text);
  return statusExitCode(reports, output.strict);
}

async function repoRoot(cwd: string): Promise<string | undefined> {
  const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
  const root = top.stdout.trim();
  return top.code === 0 && root !== "" ? root : undefined;
}

async function runInRepo(
  command: Command,
  root: string,
  context: { args: Arguments; io: Io },
): Promise<number> {
  const { args, io } = context;
  if (command === "init") {
    const flags = initFlags(args.values);
    return flags.ok ? runInit(root, flags.flags, io) : fail(io, flags.error);
  }
  const loaded = await loadConfig(root);
  if (!loaded.ok) return fail(io, loaded.error);
  if (command === "preview") {
    const port = parsePort(args.values.port);
    return port.ok
      ? runPreview(root, loaded.config, { io, port: port.port })
      : fail(io, port.error);
  }
  const output = { io, json: args.values.json ?? false };
  if (command === "check") return runCheck(root, loaded.config, output);
  return runStatus(root, loaded.config, { ...output, strict: args.values.strict ?? false });
}

/** コマンドを実行して終了コードを返す。出力は io に渡し、プロセスは終了させない。 */
export async function run(argv: string[], io: Io, cwd: string): Promise<number> {
  const read = tryReadArguments(argv);
  if (!read.ok) {
    io.err(`tidyspec: ${read.error}\n\n${USAGE}`);
    return 2;
  }
  const args = read.arguments;
  const [command, ...rest] = args.positionals;
  if (args.values.help ?? false) {
    io.out(USAGE);
    return 0;
  }
  if (!isCommand(command) || rest.length > 0) {
    io.err(USAGE);
    return 2;
  }

  try {
    const root = await repoRoot(cwd);
    if (root === undefined) return fail(io, "run this inside a git repository");
    return await runInRepo(command, root, { args, io });
  } catch (error) {
    // git の失敗など。検査できなかったのを「問題なし」にはしない。
    return fail(io, error instanceof Error ? error.message : String(error));
  }
}
