import type { HookReport, Violation } from "./hook.js";
import type { Problem, ProblemKind } from "./parse.js";
import { severityOf } from "./parse.js";
import type { FileState } from "./staleness.js";
import type { ScreenStatusReport } from "./status.js";

/**
 * 画面の中身やパスは信用できない入力で、そのまま端末に出すと制御文字で端末を操作されうる。
 * 出力に混ぜる文字列は、必ずこれを通す。
 */
export function sanitize(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "?");
}

const PROBLEM_TEXT: Record<ProblemKind, (problem: Problem) => string> = {
  "missing-title": () => "タイトル（# ...）がありません",
  "duplicate-title": (p) => `タイトルが複数あります: ${p.detail}`,
  "missing-heading": (p) => `見出し「${p.detail}」がありません`,
  "duplicate-heading": (p) => `見出し「${p.detail}」が複数あります`,
  "long-line": (p) => `行が長すぎます（${p.detail}文字）。一行に一つの主張にしてください`,
  "code-line-without-path": (p) => `コードの行にファイルパスがありません: ${p.detail}`,
  "unknown-heading": (p) => `決まっていない見出しです: ${p.detail}`,
  "unexpected-heading": (p) => `ここで三段目以降の見出しは使えません: ${p.detail}`,
  "text-outside-section": (p) => `見出しの外に文章があります: ${p.detail}`,
  "not-a-bullet": (p) => `箇条書きではない行です: ${p.detail}`,
  "nested-bullet": (p) => `入れ子の箇条書きは読み取りません: ${p.detail}`,
};

function describeProblem(problem: Problem): string {
  return sanitize(PROBLEM_TEXT[problem.kind](problem));
}

function at(screen: string, line: number | null): string {
  return line === null ? sanitize(screen) : `${sanitize(screen)}:${line}`;
}

function describeViolation(violation: Violation): string {
  switch (violation.kind) {
    case "screen-problem":
      return `${at(violation.screen, violation.problem.line)}: ${describeProblem(violation.problem)}`;
    case "screen-unreadable":
      return `${at(violation.screen, null)}: 読み取れません`;
    case "code-file-missing":
      return `${at(violation.screen, violation.line)}: コードの行が指すファイルがありません: ${sanitize(violation.path)}`;
    case "spec-not-updated":
      return [
        `${sanitize(violation.file)} を変えましたが、これを「コード」に載せている画面が更新されていません。`,
        `  実装に合わせて、次のどれかの仕様・設計・コード・データを直してください: ${violation.screens.map(sanitize).join(", ")}`,
      ].join("\n");
    default: {
      const unreachable: never = violation;
      throw new Error(`unhandled violation: ${JSON.stringify(unreachable)}`);
    }
  }
}

export function renderCheck(report: HookReport): string {
  const lines: string[] = [];
  for (const violation of report.violations) lines.push(`エラー ${describeViolation(violation)}`);
  for (const { screen, problem } of report.warnings) {
    lines.push(`警告 ${at(screen, problem.line)}: ${describeProblem(problem)}`);
  }
  if (report.unregistered.length > 0) {
    lines.push(`どの画面の「コード」にも載っていない実装: ${report.unregistered.map(sanitize).join(", ")}`);
  }
  if (report.ok) lines.push("仕様の検査: 問題なし");
  return lines.join("\n");
}

const FILE_TEXT: Record<FileState, string | null> = {
  aligned: null,
  stale: "実装の方が新しい",
  "working-changes": "作業中の差分あり",
  untracked: "まだコミットされていない",
  missing: "ファイルがない",
  unchecked: "古さを調べていない",
};

export function renderStatus(reports: ScreenStatusReport[]): string {
  const lines: string[] = [];
  for (const { screen, problems, staleness } of reports) {
    const marks: string[] = [];
    for (const problem of problems) {
      const label = severityOf(problem) === "error" ? "エラー" : "警告";
      const where = problem.line === null ? "" : `${problem.line}行目: `;
      marks.push(`  ${label} ${where}${describeProblem(problem)}`);
    }
    for (const file of staleness.files) {
      const text = FILE_TEXT[file.state];
      if (text !== null) marks.push(`  ${text}: ${sanitize(file.path)}`);
    }
    if (staleness.status === "unknown") marks.push("  古さを判定できません（履歴が浅い clone です。fetch-depth: 0 などで全履歴を取ってください）");
    if (staleness.status === "no-git") marks.push("  古さを判定できません（git の管理下にありません）");
    lines.push(`${sanitize(screen)}: ${marks.length === 0 ? "揃っている" : ""}`.trimEnd());
    lines.push(...marks);
  }
  if (reports.length === 0) lines.push("画面が見つかりません");
  return lines.join("\n");
}

/** status の終了コード。判定できない（浅い clone など）は、strict のときだけ失敗にする。 */
export function statusExitCode(reports: ScreenStatusReport[], strict: boolean): 0 | 1 {
  for (const { problems, staleness } of reports) {
    if (problems.some((problem) => severityOf(problem) === "error")) return 1;
    if (staleness.status === "stale" || staleness.status === "missing") return 1;
    if (strict && (staleness.status === "unknown" || staleness.status === "no-git")) return 1;
  }
  return 0;
}
