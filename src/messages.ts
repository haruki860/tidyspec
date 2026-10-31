import type { Language } from "./language.js";
import type { ProblemKind } from "./parse.js";
import type { FileState } from "./staleness.js";

/**
 * 画面ファイルについての指摘の文言。エージェントが読むので、画面ファイルと同じ言語にする。
 * 引数に入る文字列（行の中身、パス）は呼び出し側で無害化済みで、ここでは何もしない。
 */
export interface Messages {
  problem: Record<ProblemKind, (detail: string) => string>;
  atLine(line: number): string;
  errorLabel: string;
  warningLabel: string;
  screenUnreadable: string;
  codeFileMissing(path: string): string;
  specNotUpdated(file: string, screens: string[]): string;
  unregistered(files: string[]): string;
  checkPassed: string;
  upToDate: string;
  fileState: Record<FileState, string | null>;
  undeterminedShallow: string;
  undeterminedNoGit: string;
  noScreens: string;
}

const en: Messages = {
  problem: {
    "missing-title": () => "Missing title (a line starting with '# ')",
    "duplicate-title": (d) => `More than one title: ${d}`,
    "missing-heading": (d) => `Missing heading "${d}"`,
    "duplicate-heading": (d) => `Heading "${d}" appears more than once`,
    "long-line": (d) => `Line is too long (${d} characters). Keep one claim per line`,
    "code-line-without-path": (d) => `Code line has no file path: ${d}`,
    "unknown-heading": (d) => `Not one of the fixed headings: ${d}`,
    "unexpected-heading": (d) => `Headings below level 2 are not used here: ${d}`,
    "text-outside-section": (d) => `Text outside any section: ${d}`,
    "not-a-bullet": (d) => `Not a bullet: ${d}`,
    "nested-bullet": (d) => `Nested bullets are not read: ${d}`,
  },
  atLine: (line) => `line ${line}: `,
  errorLabel: "error",
  warningLabel: "warning",
  screenUnreadable: "Cannot read the screen file",
  codeFileMissing: (path) => `The file named by this code line does not exist: ${path}`,
  specNotUpdated: (file, screens) =>
    `${file} changed, but no screen that lists it under Code was updated.\n  Update one of these to match the change: ${screens.join(", ")}`,
  unregistered: (files) => `Changed files that no screen lists under Code: ${files.join(", ")}`,
  checkPassed: "Spec check: no problems",
  upToDate: "up to date",
  fileState: {
    aligned: null,
    stale: "code is newer than the spec",
    "working-changes": "uncommitted changes",
    untracked: "not committed yet",
    missing: "file not found",
    unchecked: "staleness not checked",
  },
  undeterminedShallow:
    "Cannot tell whether this is up to date (shallow clone; fetch the full history, e.g. fetch-depth: 0)",
  undeterminedNoGit: "Cannot tell whether this is up to date (not under git)",
  noScreens: "No screens found",
};

const ja: Messages = {
  problem: {
    "missing-title": () => "タイトル（# ...）がありません",
    "duplicate-title": (d) => `タイトルが複数あります: ${d}`,
    "missing-heading": (d) => `見出し「${d}」がありません`,
    "duplicate-heading": (d) => `見出し「${d}」が複数あります`,
    "long-line": (d) => `行が長すぎます（${d}文字）。一行に一つの主張にしてください`,
    "code-line-without-path": (d) => `コードの行にファイルパスがありません: ${d}`,
    "unknown-heading": (d) => `決まっていない見出しです: ${d}`,
    "unexpected-heading": (d) => `ここで三段目以降の見出しは使えません: ${d}`,
    "text-outside-section": (d) => `見出しの外に文章があります: ${d}`,
    "not-a-bullet": (d) => `箇条書きではない行です: ${d}`,
    "nested-bullet": (d) => `入れ子の箇条書きは読み取りません: ${d}`,
  },
  atLine: (line) => `${line}行目: `,
  errorLabel: "エラー",
  warningLabel: "警告",
  screenUnreadable: "読み取れません",
  codeFileMissing: (path) => `コードの行が指すファイルがありません: ${path}`,
  specNotUpdated: (file, screens) =>
    `${file} を変えましたが、これを「コード」に載せている画面が更新されていません。\n  実装に合わせて、次のどれかの仕様・設計・コード・データを直してください: ${screens.join(", ")}`,
  unregistered: (files) => `どの画面の「コード」にも載っていない実装: ${files.join(", ")}`,
  checkPassed: "仕様の検査: 問題なし",
  upToDate: "揃っている",
  fileState: {
    aligned: null,
    stale: "実装の方が新しい",
    "working-changes": "作業中の差分あり",
    untracked: "まだコミットされていない",
    missing: "ファイルがない",
    unchecked: "古さを調べていない",
  },
  undeterminedShallow:
    "古さを判定できません（履歴が浅い clone です。fetch-depth: 0 などで全履歴を取ってください）",
  undeterminedNoGit: "古さを判定できません（git の管理下にありません）",
  noScreens: "画面が見つかりません",
};

export const MESSAGES: Record<Language, Messages> = { en, ja };
