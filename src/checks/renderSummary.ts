import type { Language } from "../core/language.js";
import { sanitize } from "./render.js";
import type { ChangedScreen, Summary } from "./summary.js";

interface Words {
  heading: string;
  none: string;
  behindHeading: string;
  truncated: string;
  change: Record<ChangedScreen["change"], string>;
}

const WORDS: Record<Language, Words> = {
  en: {
    heading: "Spec changes",
    none: "No screen files changed.",
    behindHeading: "Code changed, spec not updated",
    truncated: "(more lines not shown)",
    change: { added: "added", modified: "modified", removed: "removed" },
  },
  ja: {
    heading: "仕様の変更",
    none: "変わった画面はありません。",
    behindHeading: "実装は変わったが、仕様が変わっていないもの",
    truncated: "（残りの行は省略）",
    change: { added: "追加", modified: "変更", removed: "削除" },
  },
};

/** コードスパンの中に入れる文字列から、スパンを閉じてしまうバッククォートを除く。 */
function inline(text: string): string {
  return `\`${sanitize(text).replaceAll("`", "'")}\``;
}

function label(item: { screen: string; title: string | null }): string {
  return item.title === null
    ? inline(item.screen)
    : `${sanitize(item.title)} (${inline(item.screen)})`;
}

/** 本文に含まれるバッククォートの連続より長い柵を使い、本文が柵を閉じられないようにする。 */
function fenceFor(lines: string[]): string {
  const longest = Math.max(
    0,
    ...lines.flatMap((line) => line.match(/`+/g)?.map((run) => run.length) ?? []),
  );
  return "`".repeat(Math.max(3, longest + 1));
}

function diffBlock(item: ChangedScreen, words: Words): string[] {
  if (item.lines.length === 0) return [];
  const body = item.lines.map((line) => `${line.kind === "add" ? "+" : "-"}${sanitize(line.text)}`);
  const fence = fenceFor(body);
  const more = item.truncated ? [words.truncated] : [];
  return ["", `${fence}diff`, ...body, fence, ...more];
}

function changedSection(summary: Summary, words: Words): string[] {
  if (summary.changed.length === 0) return [words.none];
  return summary.changed.flatMap((item) => [
    `### ${label(item)} — ${words.change[item.change]}`,
    ...diffBlock(item, words),
    "",
  ]);
}

function behindSection(summary: Summary, words: Words): string[] {
  if (summary.behind.length === 0) return [];
  return [
    `## ${words.behindHeading}`,
    "",
    ...summary.behind.map((item) => `- ${label(item)}: ${item.files.map(inline).join(", ")}`),
    "",
  ];
}

/** PR の説明に貼れる Markdown。文章は書かず、変わったことの事実だけを並べる。 */
export function renderSummary(summary: Summary, language: Language): string {
  const words = WORDS[language];
  const lines = [
    `## ${words.heading}`,
    "",
    ...changedSection(summary, words),
    ...behindSection(summary, words),
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}
