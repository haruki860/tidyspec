import { type Config, loadConfig } from "../config.js";
import { HEADINGS, type Language } from "../core/language.js";
import {
  DEFAULT_SCREENS_DIR,
  executeInit,
  type InitAnswers,
  type InitPlan,
  type InitStep,
  planInit,
  screensDirFromConfig,
  validateScreensDir,
} from "../setup/init.js";
import type { Io } from "./io.js";
import type { Prompter } from "./prompter.js";

export interface InitFlags {
  yes: boolean;
  language: Language | undefined;
  screensDir: string | undefined;
  noHook: boolean;
  noInstructions: boolean;
}

const NEEDS_TERMINAL =
  "tidyspec init asks questions, so run it in a terminal. To skip the questions, pass --yes " +
  "(with --lang, --screens-dir, --no-hook and --no-instructions as needed).";

function describe(step: InitStep): string {
  return `  ${step.result.padEnd(9)} ${step.file}`;
}

type Ask = Prompter | undefined;

function chooseLanguage(
  flags: InitFlags,
  ask: Ask,
  current: Language,
): Promise<Language> | Language {
  if (flags.language !== undefined) return flags.language;
  if (ask === undefined) return current;
  return ask.select<Language>(
    "Language for the section headings and the messages?",
    [
      { value: "en", label: `English (${Object.values(HEADINGS.en).join(" / ")})` },
      { value: "ja", label: `日本語 (${Object.values(HEADINGS.ja).join(" / ")})` },
    ],
    current,
  );
}

function chooseScreensDir(flags: InitFlags, ask: Ask, current: Config): Promise<string> | string {
  if (flags.screensDir !== undefined) return flags.screensDir;
  const fallback = screensDirFromConfig(current) ?? DEFAULT_SCREENS_DIR;
  return ask === undefined ? fallback : ask.text("Directory for the screen files?", fallback);
}

// 「やらない」と言われていなければ、質問できるときは聞き、聞けないときは入れる。
async function chooseOptIn(skipped: boolean, ask: Ask, question: string): Promise<boolean> {
  if (skipped) return false;
  return ask === undefined ? true : ask.confirm(question, true);
}

type AnswersResult = { ok: true; answers: InitAnswers } | { ok: false; error: string };

async function gatherAnswers(flags: InitFlags, ask: Ask, current: Config): Promise<AnswersResult> {
  const language = await chooseLanguage(flags, ask, current.language);
  const dir = validateScreensDir(await chooseScreensDir(flags, ask, current));
  if (!dir.ok) return dir;
  const installHook = await chooseOptIn(
    flags.noHook,
    ask,
    "Install a pre-commit hook that runs `tidyspec check`?",
  );
  const writeInstructions = await chooseOptIn(
    flags.noInstructions,
    ask,
    "Add the screen-spec instructions for coding agents to AGENTS.md?",
  );
  return { ok: true, answers: { language, screensDir: dir.dir, installHook, writeInstructions } };
}

/** 変更の一覧を見せて、進めてよいか聞く。質問できないとき（--yes）は聞かずに進める。 */
async function confirmPlan(io: Io, ask: Ask, plan: InitPlan): Promise<boolean> {
  if (ask === undefined) return true;
  io.out(["This will:", ...plan.steps.map(describe)].join("\n"));
  return ask.confirm("Apply these changes?", true);
}

function renderDone(plan: InitPlan, screensDir: string): string {
  return [
    ...plan.steps.map(describe),
    ...plan.notes.map((note) => `note: ${note}`),
    "",
    `Next: add one Markdown file per screen under ${screensDir}/ (see the examples in the tidyspec repository), then run \`tidyspec status\`.`,
  ].join("\n");
}

function fail(io: Io, message: string): number {
  io.err(`tidyspec: ${message}`);
  return 2;
}

/** 質問に答えてもらいながら、設定・指示文・フックを入れる。質問は端末があるときだけ。 */
export async function runInit(root: string, flags: InitFlags, io: Io): Promise<number> {
  if (!flags.yes && !io.prompt) {
    io.err(NEEDS_TERMINAL);
    return 2;
  }
  const ask: Ask = flags.yes ? undefined : io.prompt;

  const existing = await loadConfig(root);
  if (!existing.ok) return fail(io, existing.error);
  const gathered = await gatherAnswers(flags, ask, existing.config);
  if (!gathered.ok) return fail(io, gathered.error);

  // 見せた内容と書く内容がずれないように、一度だけ計画して、それを見せて、それを実行する。
  const planned = await planInit(root, gathered.answers);
  if (!planned.ok) return fail(io, planned.error);
  if (!(await confirmPlan(io, ask, planned.plan))) {
    io.out("Nothing changed.");
    return 0;
  }
  await executeInit(planned.plan);
  io.out(renderDone(planned.plan, gathered.answers.screensDir));
  return 0;
}
