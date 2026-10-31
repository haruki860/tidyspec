import { createInterface, type Interface } from "node:readline/promises";
import type { Choice, Prompter } from "./prompter.js";

type Read = (question: string) => Promise<string>;

/**
 * 質問を出して一行読む関数を作る。
 * 行は届いた順にためておく。質問より先に届いた行（貼り付けなど）を、捨てずに渡すため。
 */
function lineReader(rl: Interface): Read {
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
  return (question) => {
    process.stdout.write(question);
    const line = queued.shift();
    if (line !== undefined) return Promise.resolve(line);
    if (closed) return Promise.reject(new Error("input closed"));
    return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
  };
}

interface Selection<T extends string> {
  question: string;
  choices: readonly Choice<T>[];
  fallback: T;
}

async function select<T extends string>(read: Read, selection: Selection<T>): Promise<T> {
  const { question, choices, fallback } = selection;
  const fallbackIndex = Math.max(
    0,
    choices.findIndex((choice) => choice.value === fallback),
  );
  const list = choices.map((choice, i) => `  ${i + 1}) ${choice.label}`).join("\n");
  for (;;) {
    const answer = (await read(`${question}\n${list}\nChoose [${fallbackIndex + 1}]: `)).trim();
    if (answer === "") return choices[fallbackIndex]?.value ?? fallback;
    const picked = choices[Number(answer) - 1];
    if (picked) return picked.value;
    process.stdout.write("Please enter one of the numbers.\n");
  }
}

/** y / yes / n / no を真偽にする。それ以外は undefined。 */
function yesNo(answer: string): boolean | undefined {
  if (answer === "y" || answer === "yes") return true;
  if (answer === "n" || answer === "no") return false;
  return undefined;
}

async function confirm(read: Read, question: string, fallback: boolean): Promise<boolean> {
  for (;;) {
    const answer = (await read(`${question} [${fallback ? "Y/n" : "y/N"}]: `)).trim().toLowerCase();
    if (answer === "") return fallback;
    const decided = yesNo(answer);
    if (decided !== undefined) return decided;
    process.stdout.write("Please answer y or n.\n");
  }
}

async function text(read: Read, question: string, fallback: string): Promise<string> {
  const answer = (await read(`${question} [${fallback}]: `)).trim();
  return answer === "" ? fallback : answer;
}

/** 標準入出力につながった質問の口。close で入力を閉じる。 */
export function terminalPrompter(): { prompter: Prompter; close(): void } {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const read = lineReader(rl);
  const prompter: Prompter = {
    select: (question, choices, fallback) => select(read, { question, choices, fallback }),
    confirm: (question, fallback) => confirm(read, question, fallback),
    text: (question, fallback) => text(read, question, fallback),
  };
  return { prompter, close: () => rl.close() };
}
