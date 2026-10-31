#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { run } from "./cli.js";
import type { Prompter } from "./prompter.js";

/** 端末につながっているときだけ作る。つながっていなければ、質問は出せない。 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: TODO(decision 001): split or simplify in the refactor PRs; remove when fixed
function terminalPrompter(): { prompter: Prompter; close(): void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  // 行は届いた順にためておく。質問より先に届いた行（貼り付けなど）を、捨てずに渡すため。
  const queued: string[] = [];
  const waiting: { resolve(line: string): void; reject(error: Error): void }[] = [];
  let closed = false;
  rl.on("line", (line) => {
    const waiter = waiting.shift();
    if (waiter) waiter.resolve(line);
    else queued.push(line);
  });
  // 入力が閉じられたら（Ctrl-D など）、残りの行を渡し終えてから、答えを待つ側を中断する。
  rl.once("close", () => {
    closed = true;
    for (const waiter of waiting.splice(0)) waiter.reject(new Error("input closed"));
  });
  const read = (question: string): Promise<string> => {
    process.stdout.write(question);
    const line = queued.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (closed) return Promise.reject(new Error("input closed"));
    return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
  };

  const prompter: Prompter = {
    async select(question, choices, fallback) {
      const fallbackIndex = Math.max(
        0,
        choices.findIndex((choice) => choice.value === fallback),
      );
      for (;;) {
        const list = choices.map((choice, i) => `  ${i + 1}) ${choice.label}`).join("\n");
        const answer = (await read(`${question}\n${list}\nChoose [${fallbackIndex + 1}]: `)).trim();
        if (answer === "") return choices[fallbackIndex]?.value ?? fallback;
        const picked = choices[Number(answer) - 1];
        if (picked) return picked.value;
        process.stdout.write("Please enter one of the numbers.\n");
      }
    },
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: TODO(decision 001): split or simplify in the refactor PRs; remove when fixed
    async confirm(question, fallback) {
      for (;;) {
        const answer = (await read(`${question} [${fallback ? "Y/n" : "y/N"}]: `))
          .trim()
          .toLowerCase();
        if (answer === "") return fallback;
        if (answer === "y" || answer === "yes") return true;
        if (answer === "n" || answer === "no") return false;
        process.stdout.write("Please answer y or n.\n");
      }
    },
    async text(question, fallback) {
      const answer = (await read(`${question} [${fallback}]: `)).trim();
      return answer === "" ? fallback : answer;
    },
  };
  return { prompter, close: () => rl.close() };
}

const interactive = process.stdin.isTTY && process.stdout.isTTY;
const terminal = interactive ? terminalPrompter() : undefined;

try {
  process.exitCode = await run(
    process.argv.slice(2),
    {
      out: (text) => process.stdout.write(`${text}\n`),
      err: (text) => process.stderr.write(`${text}\n`),
      ...(terminal ? { prompt: terminal.prompter } : {}),
    },
    process.cwd(),
  );
} catch (error) {
  process.stderr.write(`tidyspec: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
} finally {
  terminal?.close();
}
