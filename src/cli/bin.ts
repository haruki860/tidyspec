#!/usr/bin/env node
import { run } from "./cli.js";
import { terminalPrompter } from "./terminal.js";

/** 端末につながっているときだけ作る。つながっていなければ、質問は出せない。 */
const interactive = process.stdin.isTTY && process.stdout.isTTY;
const terminal = interactive ? terminalPrompter() : undefined;

// Ctrl-C と終了要求を、preview を止める合図として渡す。
const waitForInterrupt = () =>
  new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });

try {
  process.exitCode = await run(
    process.argv.slice(2),
    {
      out: (text) => process.stdout.write(`${text}\n`),
      err: (text) => process.stderr.write(`${text}\n`),
      ...(terminal ? { prompt: terminal.prompter } : {}),
      waitForInterrupt,
    },
    process.cwd(),
  );
} catch (error) {
  process.stderr.write(`tidyspec: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
} finally {
  terminal?.close();
}
