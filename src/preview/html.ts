import type { ScreenInspection } from "../checks/status.js";
import { HEADINGS, type Language, SECTION_KEYS, type SectionKey } from "../core/language.js";
import { MESSAGES, type Messages } from "../core/messages.js";
import { type Item, type Problem, severityOf } from "../core/parse.js";
import { LABELS } from "./labels.js";

/**
 * 画面の中身とパスは信用できない入力。HTML に入れる文字列は、必ずこれを通す。
 * テンプレートの外で文字列を連結して HTML を作らない。
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const STYLE = `
body{font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#222}
h1{font-size:1.5rem}h2{font-size:1.1rem;margin-top:2rem;border-bottom:1px solid #ddd}
a{color:#0b57d0}ul{padding-left:1.2rem}code{background:#f3f3f3;padding:.05rem .3rem;border-radius:3px}
.badge{font-size:.8rem;padding:.05rem .5rem;border-radius:1rem;background:#e6f4ea;color:#137333}
.badge.warn{background:#fce8e6;color:#b3261e}.path{color:#666;font-size:.85rem}
.error{color:#b3261e}.warning{color:#8a5a00}
`;

function page(title: string, language: Language, body: string): string {
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function screenTitle(view: ScreenInspection): string {
  return view.parsed.title ?? view.screen;
}

function badge(view: ScreenInspection, language: Language): string {
  const { status } = view.staleness;
  const text = LABELS[language].screenStatus[status];
  const cls = status === "aligned" ? "badge" : "badge warn";
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

/** 画面の一覧。 */
export function renderIndex(views: ScreenInspection[], language: Language): string {
  const labels = LABELS[language];
  const rows = views.map(
    (view) =>
      `<li><a href="/screen?file=${encodeURIComponent(view.screen)}">${escapeHtml(screenTitle(view))}</a> ${badge(view, language)}<div class="path">${escapeHtml(view.screen)}</div></li>`,
  );
  const list =
    rows.length === 0 ? `<p>${escapeHtml(labels.noScreens)}</p>` : `<ul>${rows.join("")}</ul>`;
  return page(labels.screens, language, `<h1>${escapeHtml(labels.screens)}</h1>\n${list}`);
}

function items(list: Item[]): string {
  return `<ul>${list.map((item) => `<li>${escapeHtml(item.text)}</li>`).join("")}</ul>`;
}

function codeItems(view: ScreenInspection, messages: Messages): string {
  const states = new Map(view.staleness.files.map((file) => [file.path, file.state]));
  const rows = view.parsed.code.map((entry) => {
    const note = messages.fileState[states.get(entry.path) ?? "unchecked"];
    const mark = note === null ? "" : ` <span class="badge warn">${escapeHtml(note)}</span>`;
    return `<li>${escapeHtml(entry.description)}: <code>${escapeHtml(entry.path)}</code>${mark}</li>`;
  });
  return `<ul>${rows.join("")}</ul>`;
}

function section(view: ScreenInspection, key: SectionKey, language: Language): string {
  const heading = `<h2>${escapeHtml(HEADINGS[language][key])}</h2>`;
  if (key === "code") return heading + codeItems(view, MESSAGES[language]);
  return heading + items(view.parsed[key]);
}

function problemList(problems: Problem[], language: Language): string {
  if (problems.length === 0) return "";
  const m = MESSAGES[language];
  const rows = problems.map((problem) => {
    const label = severityOf(problem) === "error" ? m.errorLabel : m.warningLabel;
    const where = problem.line === null ? "" : m.atLine(problem.line);
    const text = `${label} ${where}${m.problem[problem.kind](problem.detail)}`;
    return `<li class="${severityOf(problem)}">${escapeHtml(text)}</li>`;
  });
  return `<h2>${escapeHtml(LABELS[language].problems)}</h2><ul>${rows.join("")}</ul>`;
}

/** 一つの画面。 */
export function renderScreenPage(view: ScreenInspection, language: Language): string {
  const labels = LABELS[language];
  const body = [
    `<p><a href="/">${escapeHtml(labels.back)}</a></p>`,
    `<h1>${escapeHtml(screenTitle(view))} ${badge(view, language)}</h1>`,
    `<div class="path">${escapeHtml(view.screen)}</div>`,
    problemList(view.problems, language),
    ...SECTION_KEYS.map((key) => section(view, key, language)),
  ];
  return page(screenTitle(view), language, body.join("\n"));
}

export function renderNotFound(language: Language): string {
  return page(
    "404",
    language,
    `<p><a href="/">${escapeHtml(LABELS[language].back)}</a></p><h1>404</h1>`,
  );
}
