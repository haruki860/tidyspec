import type { ScreenInspection } from "../checks/status.js";
import { HEADINGS, type Language, SECTION_KEYS, type SectionKey } from "../core/language.js";
import { MESSAGES, type Messages } from "../core/messages.js";
import { type Item, type Problem, severityOf } from "../core/parse.js";
import { LABELS } from "./labels.js";
import { STYLE } from "./style.js";

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

/** 全ページ共通の枠。サイドバーに全画面の一覧を置き、いまの画面に印を付ける。 */
function shell(
  page: { title: string; language: Language; current: string | undefined },
  views: ScreenInspection[],
  main: string,
): string {
  const { title, language, current } = page;
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="shell">
${sidebar(views, current, language)}
<div class="main">
${main}
</div>
</div>
</body>
</html>
`;
}

function screenTitle(view: ScreenInspection): string {
  return view.parsed.title ?? view.screen;
}

function isBehind(view: ScreenInspection): boolean {
  return view.staleness.status !== "aligned";
}

function badge(view: ScreenInspection, language: Language): string {
  const text = LABELS[language].screenStatus[view.staleness.status];
  const cls = isBehind(view) ? "badge warn" : "badge";
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

function screenHref(view: ScreenInspection): string {
  return `/screen?file=${encodeURIComponent(view.screen)}`;
}

function sidebar(
  views: ScreenInspection[],
  current: string | undefined,
  language: Language,
): string {
  const links = views.map((view) => {
    const active = view.screen === current ? ' aria-current="page"' : "";
    const dot = isBehind(view) ? "dot warn" : "dot";
    return `<a href="${screenHref(view)}"${active}><span class="${dot}"></span>${escapeHtml(screenTitle(view))}</a>`;
  });
  return `<aside class="side">
<a class="brand" href="/">tidy<span>spec</span></a>
<div class="group">${escapeHtml(LABELS[language].screens)}</div>
<nav class="nav">${links.join("")}</nav>
</aside>`;
}

function card(view: ScreenInspection, language: Language): string {
  return `<a class="card" href="${screenHref(view)}"><div><strong>${escapeHtml(screenTitle(view))}</strong><span class="path">${escapeHtml(view.screen)}</span></div>${badge(view, language)}</a>`;
}

/** 画面の一覧。 */
export function renderIndex(views: ScreenInspection[], language: Language): string {
  const labels = LABELS[language];
  const behind = views.filter(isBehind).length;
  const body =
    views.length === 0
      ? `<p class="lead">${escapeHtml(labels.noScreens)}</p>`
      : `<p class="lead">${escapeHtml(labels.summary(views.length, behind))}</p>\n<div class="cards">${views.map((view) => card(view, language)).join("")}</div>`;
  const main = `<main>\n<p class="eyebrow">tidyspec</p>\n<h1>${escapeHtml(labels.screens)}</h1>\n${body}\n</main>`;
  return shell({ title: labels.screens, language, current: undefined }, views, main);
}

function items(list: Item[]): string {
  return `<ul class="items">${list.map((item) => `<li>${escapeHtml(item.text)}</li>`).join("")}</ul>`;
}

function codeItems(view: ScreenInspection, messages: Messages): string {
  const states = new Map(view.staleness.files.map((file) => [file.path, file.state]));
  const rows = view.parsed.code.map((entry) => {
    const note = messages.fileState[states.get(entry.path) ?? "unchecked"];
    const mark = note === null ? "" : `<span class="badge warn">${escapeHtml(note)}</span>`;
    return `<li><span class="desc">${escapeHtml(entry.description)}</span><code>${escapeHtml(entry.path)}</code>${mark}</li>`;
  });
  return `<ul class="files">${rows.join("")}</ul>`;
}

function section(view: ScreenInspection, key: SectionKey, language: Language): string {
  const heading = `<h2 id="${key}">${escapeHtml(HEADINGS[language][key])}</h2>`;
  if (key === "code") return heading + codeItems(view, MESSAGES[language]);
  return heading + items(view.parsed[key]);
}

function problemList(problems: Problem[], language: Language): string {
  const m = MESSAGES[language];
  return problems
    .map((problem) => {
      const severity = severityOf(problem);
      const label = severity === "error" ? m.errorLabel : m.warningLabel;
      const where = problem.line === null ? "" : m.atLine(problem.line);
      const text = `${label} ${where}${m.problem[problem.kind](problem.detail)}`;
      return `<div class="callout ${severity}">${escapeHtml(text)}</div>`;
    })
    .join("\n");
}

function toc(language: Language): string {
  const links = SECTION_KEYS.map(
    (key) => `<a href="#${key}">${escapeHtml(HEADINGS[language][key])}</a>`,
  );
  return `<nav class="toc"><div class="group">${escapeHtml(LABELS[language].onThisPage)}</div>${links.join("")}</nav>`;
}

/** 一つの画面。 */
export function renderScreenPage(
  view: ScreenInspection,
  views: ScreenInspection[],
  language: Language,
): string {
  const main = `<main>
<p class="eyebrow">${escapeHtml(LABELS[language].screens)}</p>
<h1>${escapeHtml(screenTitle(view))}</h1>
<div class="meta">${badge(view, language)}<span class="path">${escapeHtml(view.screen)}</span></div>
${problemList(view.problems, language)}
${SECTION_KEYS.map((key) => section(view, key, language)).join("\n")}
</main>
${toc(language)}`;
  return shell({ title: screenTitle(view), language, current: view.screen }, views, main);
}

export function renderNotFound(views: ScreenInspection[], language: Language): string {
  const labels = LABELS[language];
  const main = `<main><p class="eyebrow">404</p><h1>404</h1><p class="lead"><a href="/">${escapeHtml(labels.back)}</a></p></main>`;
  return shell({ title: "404", language, current: undefined }, views, main);
}
