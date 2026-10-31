import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config.js";
import { CONFIG_FILE, parseConfig } from "../config.js";
import type { Language } from "../core/language.js";
import { HOOK_SCRIPT, type HookState, inspectHook, writeHook } from "./hookfile.js";
import { instructionBlock, upsertBlock } from "./instructions.js";

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

export type DirResult = { ok: true; dir: string } | { ok: false; error: string };

/**
 * 画面ファイルの置き場を検査する。この文字列は glob の設定に埋め込まれるので、
 * repo の外を指すものや、glob / パス指定の記号を含むものは受け付けない。
 */
export function validateScreensDir(input: string): DirResult {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (
    trimmed === "" ||
    trimmed.startsWith("/") ||
    trimmed.includes("\\") ||
    /[*?[\]{}!:\0]/.test(trimmed)
  ) {
    return {
      ok: false,
      error: `not a usable directory: ${JSON.stringify(input)} (use a relative path like docs/screens)`,
    };
  }
  const normalized = path.posix.normalize(trimmed);
  if (normalized === "." || normalized.split("/").includes("..")) {
    return {
      ok: false,
      error: `the screens directory must be inside the repository: ${JSON.stringify(input)}`,
    };
  }
  return { ok: true, dir: normalized };
}

// 設定の screens が、ディレクトリ名に「全ての .md」の glob を付けた一つだけなら、そのディレクトリ。init を再実行したときの既定値にする。
export function screensDirFromConfig(config: Config): string | undefined {
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
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, i) => item === expected[i])
  );
}

/** 書くもの。計画の段階では実行せず、全ての検査が通ってから実行する。 */
type PendingWrite = { kind: "file"; file: string; text: string } | { kind: "hook"; file: string };

/** init の一つの作業（設定、指示文、フック）が決めた結果。 */
interface Part {
  steps: InitStep[];
  notes: string[];
  writes: PendingWrite[];
}

type PartResult = { ok: true; part: Part } | { ok: false; error: string };

export interface InitPlan {
  steps: InitStep[];
  notes: string[];
  writes: PendingWrite[];
}

export type PlanResult = { ok: true; plan: InitPlan } | { ok: false; error: string };

const HOOK_LABEL = "pre-commit hook";
const HOOK_COMMAND = "npx --no-install tidyspec check";

function resultOf(existing: string | undefined): "created" | "updated" {
  return existing === undefined ? "created" : "updated";
}

interface LoadedConfig {
  file: string;
  text: string | undefined;
  /** 既存のキー。implementation など、init が知らないキーを書き換えずに残すため */
  stored: Map<string, unknown>;
  maxLineLength: number | undefined;
}

type LoadResult = { ok: true; loaded: LoadedConfig } | { ok: false; error: string };

async function loadConfig(root: string): Promise<LoadResult> {
  const file = path.join(root, CONFIG_FILE);
  const text = await readIfExists(file);
  if (text === undefined) {
    return { ok: true, loaded: { file, text, stored: new Map(), maxLineLength: undefined } };
  }
  const parsed = parseConfig(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const value: unknown = JSON.parse(text);
  const stored = typeof value === "object" && value !== null ? Object.entries(value) : [];
  return {
    ok: true,
    loaded: { file, text, stored: new Map(stored), maxLineLength: parsed.config.maxLineLength },
  };
}

function planConfig(loaded: LoadedConfig, answers: InitAnswers): Part {
  const screens = [`${answers.screensDir}/**/*.md`];
  const { text, stored } = loaded;
  if (
    text !== undefined &&
    stored.get("language") === answers.language &&
    sameStrings(stored.get("screens"), screens)
  ) {
    return { steps: [{ file: CONFIG_FILE, result: "unchanged" }], notes: [], writes: [] };
  }
  const next = new Map(stored).set("language", answers.language).set("screens", screens);
  const body = `${JSON.stringify(Object.fromEntries(next), null, 2)}\n`;
  return {
    steps: [{ file: CONFIG_FILE, result: resultOf(text) }],
    notes: [],
    writes: [{ kind: "file", file: loaded.file, text: body }],
  };
}

// Claude Code は CLAUDE.md を読む。AGENTS.md への道が無ければ、指示文が届かない。
async function claudeMdNotes(root: string): Promise<string[]> {
  const claude = await readIfExists(path.join(root, "CLAUDE.md"));
  if (claude === undefined || claude.includes("AGENTS.md")) return [];
  return [
    "CLAUDE.md exists but does not mention AGENTS.md. Claude Code reads CLAUDE.md, so add the line `@AGENTS.md` to it.",
  ];
}

async function planInstructions(
  root: string,
  answers: InitAnswers,
  maxLineLength: number | undefined,
): Promise<PartResult> {
  if (!answers.writeInstructions) {
    return {
      ok: true,
      part: { steps: [{ file: INSTRUCTIONS_FILE, result: "skipped" }], notes: [], writes: [] },
    };
  }
  const file = path.join(root, INSTRUCTIONS_FILE);
  const existing = await readIfExists(file);
  const block = instructionBlock(answers.language, answers.screensDir, maxLineLength);
  const upserted = upsertBlock(existing, block);
  if (!upserted.ok) return { ok: false, error: `${INSTRUCTIONS_FILE}: ${upserted.error}` };
  const notes = await claudeMdNotes(root);
  if (upserted.text === existing) {
    const steps: InitStep[] = [{ file: INSTRUCTIONS_FILE, result: "unchanged" }];
    return { ok: true, part: { steps, notes, writes: [] } };
  }
  const steps: InitStep[] = [{ file: INSTRUCTIONS_FILE, result: resultOf(existing) }];
  const writes: PendingWrite[] = [{ kind: "file", file, text: upserted.text }];
  return { ok: true, part: { steps, notes, writes } };
}

// 自分たちのフックだけ書く。他のもの（別のフック、フック管理ツール）は触らない。
function planHookFor(state: HookState, root: string): Part {
  switch (state.kind) {
    case "custom-hooks-path":
      return {
        steps: [{ file: HOOK_LABEL, result: "skipped" }],
        notes: [
          `core.hooksPath is set to "${state.value}" (a hook manager such as husky or lefthook?). Left untouched. Add \`${HOOK_COMMAND}\` to its pre-commit step.`,
        ],
        writes: [],
      };
    case "foreign": {
      const label = path.relative(root, state.file);
      return {
        steps: [{ file: label, result: "skipped" }],
        notes: [
          `A pre-commit hook already exists at ${label}. Left untouched. Add \`${HOOK_COMMAND}\` to it.`,
        ],
        writes: [],
      };
    }
    case "ours":
    case "none": {
      const label = path.relative(root, state.file);
      if (state.kind === "ours" && state.content === HOOK_SCRIPT) {
        return { steps: [{ file: label, result: "unchanged" }], notes: [], writes: [] };
      }
      const result = state.kind === "none" ? "created" : "updated";
      return {
        steps: [{ file: label, result }],
        notes: [],
        writes: [{ kind: "hook", file: state.file }],
      };
    }
    default: {
      const unreachable: never = state;
      throw new Error(`unhandled hook state: ${JSON.stringify(unreachable)}`);
    }
  }
}

async function planHook(root: string, answers: InitAnswers): Promise<Part> {
  if (!answers.installHook) {
    return { steps: [{ file: HOOK_LABEL, result: "skipped" }], notes: [], writes: [] };
  }
  return planHookFor(await inspectHook(root), root);
}

/**
 * init が何をするかを決める。何も書かない。
 * 確認で見せる内容と、実際に起きることがずれないように、見せるのも書くのもこの結果。
 */
export async function planInit(root: string, answers: InitAnswers): Promise<PlanResult> {
  const config = await loadConfig(root);
  if (!config.ok) return config;
  const instructions = await planInstructions(root, answers, config.loaded.maxLineLength);
  if (!instructions.ok) return instructions;
  const parts = [
    planConfig(config.loaded, answers),
    instructions.part,
    await planHook(root, answers),
  ];
  return {
    ok: true,
    plan: {
      steps: parts.flatMap((part) => part.steps),
      notes: parts.flatMap((part) => part.notes),
      writes: parts.flatMap((part) => part.writes),
    },
  };
}

/** 計画を実行する。計画が成功したあとにだけ呼ぶ。 */
export async function executeInit(plan: InitPlan): Promise<void> {
  for (const write of plan.writes) {
    if (write.kind === "file") await writeFile(write.file, write.text);
    else await writeHook(write.file);
  }
}
