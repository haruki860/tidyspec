import type { HookReport, Violation } from "./hook.js";
import { DEFAULT_LANGUAGE, type Language } from "./language.js";
import { MESSAGES, type Messages } from "./messages.js";
import type { Problem } from "./parse.js";
import { severityOf } from "./parse.js";
import type { ScreenStatusReport } from "./status.js";

/**
 * 画面の中身やパスは信用できない入力で、そのまま端末に出すと制御文字で端末を操作されうる。
 * 出力に混ぜる文字列は、必ずこれを通す。
 */
export function sanitize(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "?");
}

function describeProblem(m: Messages, problem: Problem): string {
  return m.problem[problem.kind](sanitize(problem.detail));
}

function at(screen: string, line: number | null): string {
  return line === null ? sanitize(screen) : `${sanitize(screen)}:${line}`;
}

function describeViolation(m: Messages, violation: Violation): string {
  switch (violation.kind) {
    case "screen-problem":
      return `${at(violation.screen, violation.problem.line)}: ${describeProblem(m, violation.problem)}`;
    case "screen-unreadable":
      return `${at(violation.screen, null)}: ${m.screenUnreadable}`;
    case "code-file-missing":
      return `${at(violation.screen, violation.line)}: ${m.codeFileMissing(sanitize(violation.path))}`;
    case "spec-not-updated":
      return m.specNotUpdated(sanitize(violation.file), violation.screens.map(sanitize));
    default: {
      const unreachable: never = violation;
      throw new Error(`unhandled violation: ${JSON.stringify(unreachable)}`);
    }
  }
}

export function renderCheck(report: HookReport, language: Language = DEFAULT_LANGUAGE): string {
  const m = MESSAGES[language];
  const lines: string[] = [];
  for (const violation of report.violations) lines.push(`${m.errorLabel} ${describeViolation(m, violation)}`);
  for (const { screen, problem } of report.warnings) {
    lines.push(`${m.warningLabel} ${at(screen, problem.line)}: ${describeProblem(m, problem)}`);
  }
  if (report.unregistered.length > 0) lines.push(m.unregistered(report.unregistered.map(sanitize)));
  if (report.ok) lines.push(m.checkPassed);
  return lines.join("\n");
}

export function renderStatus(reports: ScreenStatusReport[], language: Language = DEFAULT_LANGUAGE): string {
  const m = MESSAGES[language];
  const lines: string[] = [];
  for (const { screen, problems, staleness } of reports) {
    const marks: string[] = [];
    for (const problem of problems) {
      const label = severityOf(problem) === "error" ? m.errorLabel : m.warningLabel;
      const where = problem.line === null ? "" : m.atLine(problem.line);
      marks.push(`  ${label} ${where}${describeProblem(m, problem)}`);
    }
    for (const file of staleness.files) {
      const text = m.fileState[file.state];
      if (text !== null) marks.push(`  ${text}: ${sanitize(file.path)}`);
    }
    if (staleness.status === "unknown") marks.push(`  ${m.undeterminedShallow}`);
    if (staleness.status === "no-git") marks.push(`  ${m.undeterminedNoGit}`);
    lines.push(`${sanitize(screen)}: ${marks.length === 0 ? m.upToDate : ""}`.trimEnd());
    lines.push(...marks);
  }
  if (reports.length === 0) lines.push(m.noScreens);
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
