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
  maxLineLength?: number;
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

/**
 * 画面の Markdown を読む。形が崩れていても、読めた分は screen に入れ、問題は problems に積む。
 * 文章の正しさは見ない。
 */
export function parseScreen(source: string, options: ParseOptions = {}): ParseResult {
  const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
  const language = options.language ?? DEFAULT_LANGUAGE;
  const screen: ParsedScreen = { title: null, spec: [], design: [], code: [], data: [] };
  const problems: Problem[] = [];
  const seen = new Set<SectionKey>();
  let cursor: Cursor = { kind: "before-sections" };
  let fence: string | null = null;

  const lines = source.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  lines.forEach((raw, index) => {
    const line = index + 1;

    const fenceMatch = FENCE.exec(raw);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      if (fence === null) {
        fence = marker;
        if (cursor.kind === "section")
          problems.push({ kind: "not-a-bullet", line, detail: raw.trim() });
      } else if (fence === marker) {
        fence = null;
      }
      return;
    }
    if (fence !== null) return;

    const heading = HEADING.exec(raw);
    if (heading) {
      const level = heading[1]?.length ?? 0;
      const text = heading[2] ?? "";
      if (level === 1) {
        if (screen.title === null) screen.title = text;
        else problems.push({ kind: "duplicate-title", line, detail: text });
        cursor = { kind: "before-sections" };
      } else if (level === 2) {
        const key = sectionOf(language, text);
        if (key === undefined) {
          problems.push({ kind: "unknown-heading", line, detail: text });
          cursor = { kind: "skipped" };
        } else if (seen.has(key)) {
          problems.push({ kind: "duplicate-heading", line, detail: text });
          cursor = { kind: "skipped" };
        } else {
          seen.add(key);
          cursor = { kind: "section", key };
        }
      } else {
        problems.push({ kind: "unexpected-heading", line, detail: text });
      }
      return;
    }

    if (raw.trim() === "" || cursor.kind === "skipped") return;

    if (cursor.kind === "before-sections") {
      problems.push({ kind: "text-outside-section", line, detail: raw.trim() });
      return;
    }

    const bullet = BULLET.exec(raw);
    const text = bullet?.[1];
    if (text === undefined) {
      const kind = NESTED_BULLET.test(raw) ? "nested-bullet" : "not-a-bullet";
      problems.push({ kind, line, detail: raw.trim() });
      return;
    }

    const section = cursor.key;
    // データは名前の並びなので、長さは見ない。
    if (section !== "data" && lengthOf(text) > maxLineLength) {
      problems.push({ kind: "long-line", line, detail: String(lengthOf(text)) });
    }

    const item: Item = { text, line };
    switch (section) {
      case "spec":
        screen.spec.push(item);
        break;
      case "design":
        screen.design.push(item);
        break;
      case "data":
        screen.data.push({ text: text.replace(/^`(.+)`$/, "$1"), line });
        break;
      case "code": {
        const parts = splitCodeLine(text);
        if (parts) screen.code.push({ ...item, ...parts });
        else problems.push({ kind: "code-line-without-path", line, detail: text });
        break;
      }
      default: {
        const unreachable: never = section;
        throw new Error(`unhandled section: ${String(unreachable)}`);
      }
    }
  });

  if (screen.title === null) problems.push({ kind: "missing-title", line: null, detail: "" });
  for (const key of SECTION_KEYS) {
    if (!seen.has(key))
      problems.push({ kind: "missing-heading", line: null, detail: HEADINGS[language][key] });
  }
  return { screen, problems };
}
