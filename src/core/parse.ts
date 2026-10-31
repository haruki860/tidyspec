import {
  DEFAULT_LANGUAGE,
  HEADINGS,
  type Language,
  SECTION_KEYS,
  type SectionKey,
  sectionOf,
} from "./language.js";

/** 一行の長さの上限（コードポイント）。サンプルの最長行から仮に決めた値で、変わりうる。 */
export const DEFAULT_MAX_LINE_LENGTH = 80;

export interface Item {
  text: string;
  /** 1 始まり */
  line: number;
}

export interface CodeEntry extends Item {
  description: string;
  /** 「コード」の行が指すファイル。信用しない入力なので、使う側が repo の中かを確かめる */
  path: string;
}

export interface ParsedScreen {
  title: string | null;
  spec: Item[];
  design: Item[];
  code: CodeEntry[];
  data: Item[];
}

export type ProblemKind =
  | "missing-title"
  | "duplicate-title"
  | "missing-heading"
  | "duplicate-heading"
  | "long-line"
  | "code-line-without-path"
  | "unknown-heading"
  | "unexpected-heading"
  | "text-outside-section"
  | "not-a-bullet"
  | "nested-bullet";

export interface Problem {
  kind: ProblemKind;
  /** 画面全体の問題（見出しが無いなど）は null */
  line: number | null;
  /** 見出しの名前、行の長さなど、kind ごとの補足 */
  detail: string;
}

export interface ParseOptions {
  /** 渡さない、または undefined なら既定値 */
  maxLineLength?: number | undefined;
  /** 見出しの言語。既定は英語 */
  language?: Language;
}

export interface ParseResult {
  screen: ParsedScreen;
  problems: Problem[];
}

// 深刻さは kind から決める。コミット時の検査は error だけで止める。
const SEVERITY: Record<ProblemKind, "error" | "warning"> = {
  "missing-title": "error",
  "duplicate-title": "error",
  "missing-heading": "error",
  "duplicate-heading": "error",
  "long-line": "error",
  "code-line-without-path": "error",
  "unknown-heading": "warning",
  "unexpected-heading": "warning",
  "text-outside-section": "warning",
  "not-a-bullet": "warning",
  "nested-bullet": "warning",
};

export function severityOf(problem: Problem): "error" | "warning" {
  return SEVERITY[problem.kind];
}

export function hasErrors(problems: Problem[]): boolean {
  return problems.some((problem) => severityOf(problem) === "error");
}

type Cursor =
  | { kind: "before-sections" }
  | { kind: "section"; key: SectionKey }
  // 未知の見出しや二重の見出しの下。問題は見出しの時点で出しているので、中身は読み飛ばす
  | { kind: "skipped" };

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t]*$/;
const FENCE = /^[ \t]*(```|~~~)/;
const BULLET = /^[-*][ \t]+(.+?)[ \t]*$/;
const NESTED_BULLET = /^[ \t]+[-*][ \t]+/;
// 説明と、最後の「: 」または「：」の後ろのパス。パスに空白は含めない。
const CODE_LINE = /^(.+?)[ \t]*(?::[ \t]+|：[ \t]*)(\S+)$/;

function lengthOf(text: string): number {
  return [...text].length;
}

/** 「コード」の行を、説明とファイルパスに分ける。パスが無ければ null。 */
export function splitCodeLine(text: string): { description: string; path: string } | null {
  const match = CODE_LINE.exec(text);
  const description = match?.[1];
  const rawPath = match?.[2];
  if (description === undefined || rawPath === undefined) return null;
  const path = rawPath.replace(/^`(.+)`$/, "$1");
  return path === "" ? null : { description, path };
}

// 一行ずつ読み進めるときの状態。読み取りの関数はこれを書き換える。
interface Reader {
  readonly language: Language;
  readonly maxLineLength: number;
  readonly screen: ParsedScreen;
  readonly problems: Problem[];
  readonly seen: Set<SectionKey>;
  cursor: Cursor;
  /** コードブロックの中にいる間は、開いた記号。中身は読まない */
  fence: string | null;
}

function report(reader: Reader, problem: Problem): void {
  reader.problems.push(problem);
}

/** コードブロックの開始・終了の行なら状態を更新して true を返す。 */
function readFence(reader: Reader, raw: string, line: number): boolean {
  const marker = FENCE.exec(raw)?.[1];
  if (marker === undefined) return false;
  if (reader.fence === null) {
    reader.fence = marker;
    if (reader.cursor.kind === "section")
      report(reader, { kind: "not-a-bullet", line, detail: raw.trim() });
  } else if (reader.fence === marker) {
    reader.fence = null;
  }
  return true;
}

function readTitle(reader: Reader, text: string, line: number): void {
  if (reader.screen.title === null) reader.screen.title = text;
  else report(reader, { kind: "duplicate-title", line, detail: text });
  reader.cursor = { kind: "before-sections" };
}

function readSectionHeading(reader: Reader, text: string, line: number): void {
  const key = sectionOf(reader.language, text);
  if (key === undefined) {
    report(reader, { kind: "unknown-heading", line, detail: text });
    reader.cursor = { kind: "skipped" };
  } else if (reader.seen.has(key)) {
    report(reader, { kind: "duplicate-heading", line, detail: text });
    reader.cursor = { kind: "skipped" };
  } else {
    reader.seen.add(key);
    reader.cursor = { kind: "section", key };
  }
}

/** 見出しの行なら読んで true を返す。 */
function readHeading(reader: Reader, raw: string, line: number): boolean {
  const match = HEADING.exec(raw);
  if (!match) return false;
  const level = match[1]?.length ?? 0;
  const text = match[2] ?? "";
  if (level === 1) readTitle(reader, text, line);
  else if (level === 2) readSectionHeading(reader, text, line);
  else report(reader, { kind: "unexpected-heading", line, detail: text });
  return true;
}

function addItem(reader: Reader, section: SectionKey, item: Item): void {
  const { screen } = reader;
  const { text, line } = item;
  switch (section) {
    case "spec":
      screen.spec.push({ text, line });
      break;
    case "design":
      screen.design.push({ text, line });
      break;
    case "data":
      screen.data.push({ text: text.replace(/^`(.+)`$/, "$1"), line });
      break;
    case "code": {
      const parts = splitCodeLine(text);
      if (parts) screen.code.push({ text, line, ...parts });
      else report(reader, { kind: "code-line-without-path", line, detail: text });
      break;
    }
    default: {
      const unreachable: never = section;
      throw new Error(`unhandled section: ${String(unreachable)}`);
    }
  }
}

function readBullet(reader: Reader, section: SectionKey, row: Item): void {
  const { text: raw, line } = row;
  const text = BULLET.exec(raw)?.[1];
  if (text === undefined) {
    report(reader, {
      kind: NESTED_BULLET.test(raw) ? "nested-bullet" : "not-a-bullet",
      line,
      detail: raw.trim(),
    });
    return;
  }
  // データは名前の並びなので、長さは見ない。
  if (section !== "data" && lengthOf(text) > reader.maxLineLength) {
    report(reader, { kind: "long-line", line, detail: String(lengthOf(text)) });
  }
  addItem(reader, section, { text, line });
}

function readLine(reader: Reader, raw: string, line: number): void {
  if (readFence(reader, raw, line) || reader.fence !== null) return;
  if (readHeading(reader, raw, line)) return;
  if (raw.trim() === "" || reader.cursor.kind === "skipped") return;
  if (reader.cursor.kind === "before-sections") {
    report(reader, { kind: "text-outside-section", line, detail: raw.trim() });
    return;
  }
  readBullet(reader, reader.cursor.key, { text: raw, line });
}

/** 全体で一つだけの要素（題名と四つの見出し）が揃っているかを見る。 */
function reportMissing(reader: Reader): void {
  if (reader.screen.title === null) {
    reader.problems.push({ kind: "missing-title", line: null, detail: "" });
  }
  for (const key of SECTION_KEYS) {
    if (reader.seen.has(key)) continue;
    const detail = HEADINGS[reader.language][key];
    reader.problems.push({ kind: "missing-heading", line: null, detail });
  }
}

/**
 * 画面の Markdown を読む。形が崩れていても、読めた分は screen に入れ、問題は problems に積む。
 * 文章の正しさは見ない。
 */
export function parseScreen(source: string, options: ParseOptions = {}): ParseResult {
  const reader: Reader = {
    language: options.language ?? DEFAULT_LANGUAGE,
    maxLineLength: options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH,
    screen: { title: null, spec: [], design: [], code: [], data: [] },
    problems: [],
    seen: new Set(),
    cursor: { kind: "before-sections" },
    fence: null,
  };
  const lines = source.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  lines.forEach((raw, index) => {
    readLine(reader, raw, index + 1);
  });
  reportMissing(reader);
  return { screen: reader.screen, problems: reader.problems };
}
