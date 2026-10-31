import type { Io } from "./cli.js";
import { loadConfig } from "./config.js";
import {
  applyInit,
  DEFAULT_SCREENS_DIR,
  type InitStep,
  screensDirFromConfig,
  validateScreensDir,
} from "./init.js";
import { HEADINGS, type Language } from "./language.js";

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

/** 質問に答えてもらいながら、設定・指示文・フックを入れる。質問は端末があるときだけ。 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: TODO(decision 001): split or simplify in the refactor PRs; remove when fixed
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: TODO(decision 001): split or simplify in the refactor PRs; remove when fixed
export async function runInit(root: string, flags: InitFlags, io: Io): Promise<number> {
  const ask = flags.yes ? undefined : io.prompt;
  if (!flags.yes && !io.prompt) {
    io.err(NEEDS_TERMINAL);
    return 2;
  }

  const existing = await loadConfig(root);
  if (!existing.ok) {
    io.err(`tidyspec: ${existing.error}`);
    return 2;
  }
  const current = existing.config;

  const language =
    flags.language ??
    (ask
      ? await ask.select<Language>(
          "Language for the section headings and the messages?",
          [
            { value: "en", label: `English (${Object.values(HEADINGS.en).join(" / ")})` },
            { value: "ja", label: `日本語 (${Object.values(HEADINGS.ja).join(" / ")})` },
          ],
          current.language,
        )
      : current.language);

  const dirInput =
    flags.screensDir ??
    (ask
      ? await ask.text(
          "Directory for the screen files?",
          screensDirFromConfig(current) ?? DEFAULT_SCREENS_DIR,
        )
      : (screensDirFromConfig(current) ?? DEFAULT_SCREENS_DIR));
  const dir = validateScreensDir(dirInput);
  if (!dir.ok) {
    io.err(`tidyspec: ${dir.error}`);
    return 2;
  }

  const installHook = flags.noHook
    ? false
    : // biome-ignore lint/style/noNestedTernary: TODO(decision 001): split or simplify in the refactor PRs; remove when fixed
      ask
      ? await ask.confirm("Install a pre-commit hook that runs `tidyspec check`?", true)
      : true;
  const writeInstructions = flags.noInstructions
    ? false
    : // biome-ignore lint/style/noNestedTernary: TODO(decision 001): split or simplify in the refactor PRs; remove when fixed
      ask
      ? await ask.confirm("Add the screen-spec instructions for coding agents to AGENTS.md?", true)
      : true;

  const answers = { language, screensDir: dir.dir, installHook, writeInstructions };

  // まず書かずに結果だけ出して、確認してから同じ処理で書く。
  const preview = await applyInit(root, answers, { dryRun: true });
  if (!preview.ok) {
    io.err(`tidyspec: ${preview.error}`);
    return 2;
  }
  if (ask) {
    io.out(["This will:", ...preview.steps.map(describe)].join("\n"));
    if (!(await ask.confirm("Apply these changes?", true))) {
      io.out("Nothing changed.");
      return 0;
    }
  }

  const result = await applyInit(root, answers, { dryRun: false });
  if (!result.ok) {
    io.err(`tidyspec: ${result.error}`);
    return 2;
  }
  io.out(
    [
      ...result.steps.map(describe),
      ...result.notes.map((note) => `note: ${note}`),
      "",
      `Next: add one Markdown file per screen under ${dir.dir}/ (see the examples in the tidyspec repository), then run \`tidyspec status\`.`,
    ].join("\n"),
  );
  return 0;
}
