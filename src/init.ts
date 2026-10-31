import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONFIG_FILE, parseConfig } from "./config.js";
import type { HookConfig } from "./hook.js";
import { HOOK_SCRIPT, inspectHook, writeHook } from "./hookfile.js";
import { instructionBlock, upsertBlock } from "./instructions.js";
import type { Language } from "./language.js";

export const DEFAULT_SCREENS_DIR = "docs/screens";
export const INSTRUCTIONS_FILE = "AGENTS.md";

export interface InitAnswers {
  language: Language;
  screensDir: string;
  installHook: boolean;
  writeInstructions: boolean;
}

export interface InitStep {
  file: string;
  result: "created" | "updated" | "unchanged" | "skipped";
}

export type InitResult =
  | { ok: true; steps: InitStep[]; notes: string[] }
  | { ok: false; error: string };

export type DirResult = { ok: true; dir: string } | { ok: false; error: string };

/**
 * 画面ファイルの置き場を検査する。この文字列は glob の設定に埋め込まれるので、
 * repo の外を指すものや、glob / パス指定の記号を含むものは受け付けない。
 */
export function validateScreensDir(input: string): DirResult {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (trimmed === "" || trimmed.startsWith("/") || trimmed.includes("\\") || /[*?[\]{}!:\0]/.test(trimmed)) {
    return { ok: false, error: `not a usable directory: ${JSON.stringify(input)} (use a relative path like docs/screens)` };
  }
  const normalized = path.posix.normalize(trimmed);
  if (normalized === "." || normalized.split("/").includes("..")) {
    return { ok: false, error: `the screens directory must be inside the repository: ${JSON.stringify(input)}` };
  }
  return { ok: true, dir: normalized };
}

// 設定の screens が、ディレクトリ名に「全ての .md」の glob を付けた一つだけなら、そのディレクトリ。init を再実行したときの既定値にする。
export function screensDirFromConfig(config: HookConfig): string | undefined {
  const [only, ...rest] = config.screens;
  if (only === undefined || rest.length > 0) return undefined;
  const dir = /^(.+)\/\*\*\/\*\.md$/.exec(only)?.[1];
  return dir !== undefined && validateScreensDir(dir).ok ? dir : undefined;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function sameStrings(value: unknown, expected: string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, i) => item === expected[i]);
}

/**
 * init が書くものを決めて書く。dryRun のときは書かずに、同じ結果だけ返す
 * （確認で見せた内容と、実際に起きることがずれないように、同じ処理を通す）。
 */
export async function applyInit(
  root: string,
  answers: InitAnswers,
  options: { dryRun: boolean },
): Promise<InitResult> {
  const steps: InitStep[] = [];
  const notes: string[] = [];
  // 書き込みはためておき、全ての検査が通ってから実行する。途中で失敗して、一部だけ書かれた状態にしないため。
  const pending: (() => Promise<void>)[] = [];
  const write = (file: string, text: string) => {
    pending.push(() => writeFile(file, text));
  };

  // 1. tidyspec.json。他のキー（implementation など）は、書き換えずに残す。
  const configPath = path.join(root, CONFIG_FILE);
  const configText = await readIfExists(configPath);
  let record: Record<string, unknown> = {};
  let maxLineLength: number | undefined;
  if (configText !== undefined) {
    const parsed = parseConfig(configText);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const value: unknown = JSON.parse(configText);
    if (typeof value === "object" && value !== null) record = Object.fromEntries(Object.entries(value));
    maxLineLength = parsed.config.maxLineLength;
  }
  const screens = [`${answers.screensDir}/**/*.md`];
  if (configText !== undefined && record.language === answers.language && sameStrings(record.screens, screens)) {
    steps.push({ file: CONFIG_FILE, result: "unchanged" });
  } else {
    record.language = answers.language;
    record.screens = screens;
    write(configPath, `${JSON.stringify(record, null, 2)}\n`);
    steps.push({ file: CONFIG_FILE, result: configText === undefined ? "created" : "updated" });
  }

  // 2. AGENTS.md の指示文
  if (answers.writeInstructions) {
    const file = path.join(root, INSTRUCTIONS_FILE);
    const existing = await readIfExists(file);
    const block = instructionBlock(answers.language, answers.screensDir, maxLineLength);
    const upserted = upsertBlock(existing, block);
    if (!upserted.ok) return { ok: false, error: `${INSTRUCTIONS_FILE}: ${upserted.error}` };
    if (upserted.text === existing) {
      steps.push({ file: INSTRUCTIONS_FILE, result: "unchanged" });
    } else {
      write(file, upserted.text);
      steps.push({ file: INSTRUCTIONS_FILE, result: existing === undefined ? "created" : "updated" });
    }
    const claude = await readIfExists(path.join(root, "CLAUDE.md"));
    if (claude !== undefined && !claude.includes("AGENTS.md")) {
      notes.push("CLAUDE.md exists but does not mention AGENTS.md. Claude Code reads CLAUDE.md, so add the line `@AGENTS.md` to it.");
    }
  } else {
    steps.push({ file: INSTRUCTIONS_FILE, result: "skipped" });
  }

  // 3. pre-commit フック。自分たちのものだけ書く。他のものは触らない。
  if (answers.installHook) {
    const hook = await inspectHook(root);
    const command = "npx --no-install tidyspec check";
    switch (hook.kind) {
      case "custom-hooks-path":
        steps.push({ file: "pre-commit hook", result: "skipped" });
        notes.push(`core.hooksPath is set to "${hook.value}" (a hook manager such as husky or lefthook?). Left untouched. Add \`${command}\` to its pre-commit step.`);
        break;
      case "foreign":
        steps.push({ file: path.relative(root, hook.file), result: "skipped" });
        notes.push(`A pre-commit hook already exists at ${path.relative(root, hook.file)}. Left untouched. Add \`${command}\` to it.`);
        break;
      case "ours":
      case "none": {
        const label = path.relative(root, hook.file);
        if (hook.kind === "ours" && hook.content === HOOK_SCRIPT) {
          steps.push({ file: label, result: "unchanged" });
        } else {
          pending.push(() => writeHook(hook.file));
          steps.push({ file: label, result: hook.kind === "none" ? "created" : "updated" });
        }
        break;
      }
      default: {
        const unreachable: never = hook;
        throw new Error(`unhandled hook state: ${JSON.stringify(unreachable)}`);
      }
    }
  } else {
    steps.push({ file: "pre-commit hook", result: "skipped" });
  }

  if (!options.dryRun) {
    for (const action of pending) await action();
  }
  return { ok: true, steps, notes };
}
