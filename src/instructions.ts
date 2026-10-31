import { HEADINGS, type Language } from "./language.js";
import { DEFAULT_MAX_LINE_LENGTH } from "./parse.js";

export const BLOCK_START = "<!-- tidyspec:start -->";
export const BLOCK_END = "<!-- tidyspec:end -->";

type Headings = Record<"spec" | "design" | "code" | "data", string>;

interface Fill {
  h: Headings;
  dir: string;
  max: number;
}

const TEMPLATES: Record<Language, (fill: Fill) => string[]> = {
  en: ({ h, dir, max }) => [
    "## Screen specs (tidyspec)",
    "",
    `The spec for each screen lives in \`${dir}/\`, one short Markdown file per screen.`,
    "When you finish a piece of work, open only the screen files related to the code you changed, and bring them in line with the implementation.",
    "",
    `- Use only these headings, with exactly these names: ${h.spec}, ${h.design}, ${h.code}, ${h.data}. Do not rename or add headings.`,
    `- Add a line, or replace just that line. One claim per line, at most ${max} characters.`,
    `- ${h.spec}: what the user can see or do. ${h.design}: why it is built that way. ${h.code}: \`description: path/to/file\`, one file per line. ${h.data}: table names.`,
    "- Write only what someone would get wrong without it. Skip the obvious and framework defaults.",
    "- If you add a screen, add its file in the same piece of work.",
    "- Do not write behavior nobody asked for, and do not write what the code does not do.",
    "- Commit the implementation and the spec change together.",
    "- If `npx tidyspec check` stops a commit, follow its message. Do not touch unrelated lines to get past it, and do not use `--no-verify`.",
  ],
  ja: ({ h, dir, max }) => [
    "## 画面の仕様（tidyspec）",
    "",
    `画面ごとの仕様は \`${dir}/\` に、短い Markdown のファイルを一つずつ置く。`,
    "作業の終わりに、変えたコードに関係する画面のファイルだけを開き、実装に合わせて直す。",
    "",
    `- 見出しは「${h.spec}」「${h.design}」「${h.code}」「${h.data}」の四つだけ。名前を変えず、増やさない。`,
    `- 行は足すか、その行だけ差し替える。一行に一つの主張だけ、${max}文字まで。`,
    `- ${h.spec}は利用者に見えること。${h.design}はなぜそうしたか。${h.code}は \`説明: ファイルパス\` で一行に一ファイル。${h.data}はテーブル名。`,
    "- 見ないと間違える所だけを書く。自明なこと、フレームワークの定番は書かない。",
    "- 新しい画面を作ったら、その画面のファイルも同じ作業で足す。",
    "- 頼まれていない振る舞いを書かない。コードに無いことを書かない。",
    "- 実装と仕様の変更は、同じコミットに入れる。",
    "- `npx tidyspec check` がコミットを止めたら、メッセージに従う。通すために無関係な行を触らない。`--no-verify` を使わない。",
  ],
};

/** AGENTS.md に入れる指示文。目印の行で挟んであり、init を再実行すると中身だけ入れ替わる。 */
export function instructionBlock(
  language: Language,
  screensDir: string,
  maxLineLength: number = DEFAULT_MAX_LINE_LENGTH,
): string {
  const lines = TEMPLATES[language]({ h: HEADINGS[language], dir: screensDir, max: maxLineLength });
  return [BLOCK_START, ...lines, BLOCK_END].join("\n");
}

export type UpsertResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * 既存のファイルに指示文を入れる。目印があれば間だけを置き換え、無ければ末尾に足す。
 * 目印が壊れているとき（片方だけ、二重、逆順）は、ユーザーの文章を巻き込まないよう何もしない。
 */
export function upsertBlock(existing: string | undefined, block: string): UpsertResult {
  if (existing === undefined || existing.trim() === "") return { ok: true, text: `${block}\n` };

  const starts = occurrences(existing, BLOCK_START);
  const ends = occurrences(existing, BLOCK_END);
  if (starts.length === 0 && ends.length === 0) {
    return { ok: true, text: `${existing.replace(/\s+$/, "")}\n\n${block}\n` };
  }
  const start = starts[0];
  const end = ends[0];
  if (
    starts.length !== 1 ||
    ends.length !== 1 ||
    start === undefined ||
    end === undefined ||
    end < start
  ) {
    return {
      ok: false,
      error: `the ${BLOCK_START} / ${BLOCK_END} markers are damaged (need exactly one of each, in that order); fix or remove them and run init again`,
    };
  }
  return {
    ok: true,
    text: existing.slice(0, start) + block + existing.slice(end + BLOCK_END.length),
  };
}

function occurrences(text: string, needle: string): number[] {
  const found: number[] = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length))
    found.push(at);
  return found;
}
