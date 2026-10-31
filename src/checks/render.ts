import { DEFAULT_LANGUAGE, type Language } from "../core/language.js";
import { MESSAGES, type Messages } from "../core/messages.js";
import type { Problem } from "../core/parse.js";
import { severityOf } from "../core/parse.js";
import type { HookReport, Violation } from "./hook.js";
import type { ScreenStatusReport } from "./status.js";

/**
 * 画面の中身やパスは信用できない入力で、そのまま端末に出すと制御文字で端末を操作されうる。
 * 出力に混ぜる文字列は、必ずこれを通す。
 */
export function sanitize(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point of this function
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
  for (const violation of report.violations)
    lines.push(`${m.errorLabel} ${describeViolation(m, violation)}`);
  for (const { screen, problem } of report.warnings) {
    lines.push(`${m.warningLabel} ${at(screen, problem.line)}: ${describeProblem(m, problem)}`);
  }
  if (report.unregistered.length > 0) lines.push(m.unregistered(report.unregistered.map(sanitize)));
  if (report.ok) lines.push(m.checkPassed);
  return lines.join("\n");
}

function problemMarks(m: Messages, problems: Problem[]): string[] {
  return problems.map((problem) => {
    const label = severityOf(problem) === "error" ? m.errorLabel : m.warningLabel;
    const where = problem.line === null ? "" : m.atLine(problem.line);
    return `  ${label} ${where}${describeProblem(m, problem)}`;
  });
}

function fileMarks(m: Messages, staleness: ScreenStatusReport["staleness"]): string[] {
  return staleness.files.flatMap((file) => {
    const text = m.fileState[file.state];
    return text === null ? [] : [`  ${text}: ${sanitize(file.path)}`];
  });
}

// 比べられなかった理由。何も出さないと「揃っている」と読まれてしまう。
function undeterminedMarks(
  m: Messages,
  status: ScreenStatusReport["staleness"]["status"],
): string[] {
  if (status === "unknown") return [`  ${m.undeterminedShallow}`];
  if (status === "no-git") return [`  ${m.undeterminedNoGit}`];
  return [];
}

function renderScreen(m: Messages, report: ScreenStatusReport): string[] {
  const { screen, problems, staleness } = report;
  const marks = [
    ...problemMarks(m, problems),
    ...fileMarks(m, staleness),
    ...undeterminedMarks(m, staleness.status),
  ];
  const head = `${sanitize(screen)}: ${marks.length === 0 ? m.upToDate : ""}`.trimEnd();
  return [head, ...marks];
}

export function renderStatus(
  reports: ScreenStatusReport[],
  language: Language = DEFAULT_LANGUAGE,
): string {
  const m = MESSAGES[language];
  if (reports.length === 0) return m.noScreens;
  return reports.flatMap((report) => renderScreen(m, report)).join("\n");
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
