export interface DiffLine {
  kind: "add" | "remove";
  text: string;
}

export interface SpecChange {
  commit: string;
  /** コミットした日（YYYY-MM-DD） */
  date: string;
  subject: string;
  lines: DiffLine[];
  /** 行数の上限で切ったか */
  truncated: boolean;
}

/** 画面一つの変更として表示する行数の上限。巨大な差分でページを重くしない。 */
export const MAX_DIFF_LINES = 120;

/** 差分の本文から、追加・削除の行だけを取り出す。 */
export function changedLines(diff: string): DiffLine[] {
  const start = diff.indexOf("\n@@");
  // @@ が無い差分（モード変更だけ、バイナリ）の `---` / `+++` は、本文ではなくヘッダ。
  if (start === -1) return [];
  const body = diff.slice(start);
  const lines: DiffLine[] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("+")) lines.push({ kind: "add", text: line.slice(1) });
    else if (line.startsWith("-")) lines.push({ kind: "remove", text: line.slice(1) });
  }
  return lines;
}

/**
 * `git log -1 -p -U0 --format=%h%x00%cs%x00%s%x00` の出力から、直近の変更を取り出す。
 * ヘッダ（`---` / `+++`）は最初の `@@` より前にしか無いので、そこから後ろだけを読む。
 * 変更行が無い（マージなど）か、形が違えば undefined。
 */
export function parseLastChange(output: string): SpecChange | undefined {
  const [commit, date, subject, ...rest] = output.split("\0");
  if (commit === undefined || date === undefined || subject === undefined || rest.length === 0) {
    return undefined;
  }
  const lines = changedLines(rest.join("\0"));
  if (lines.length === 0) return undefined;
  return {
    commit,
    date,
    subject,
    lines: lines.slice(0, MAX_DIFF_LINES),
    truncated: lines.length > MAX_DIFF_LINES,
  };
}
