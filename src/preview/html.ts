import type { Inspection, ScreenInspection } from "../checks/status.js";
import { HEADINGS, type Language, SECTION_KEYS, type SectionKey } from "../core/language.js";
import { MESSAGES, type Messages } from "../core/messages.js";
import { type Item, type Problem, severityOf } from "../core/parse.js";
import type { Schema } from "../core/schema.js";
import { renderEr, selectTables } from "./er.js";
import { escapeHtml } from "./escape.js";
import { groupScreens, type ScreenGroup } from "./groups.js";
import { LABELS } from "./labels.js";
import { STYLE } from "./style.js";

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

function groupName(group: ScreenGroup, language: Language): string {
  return group.name === "" ? LABELS[language].ungrouped : group.name;
}

function navLink(view: ScreenInspection, current: string | undefined): string {
  const active = view.screen === current ? ' aria-current="page"' : "";
  const dot = isBehind(view) ? "dot warn" : "dot";
  return `<a href="${screenHref(view)}"${active}><span class="${dot}"></span>${escapeHtml(screenTitle(view))}</a>`;
}

/** 画面が一つのディレクトリにしか無ければ見出しは要らない。複数なら、ディレクトリごとに見出しを付ける。 */
function sidebar(
  views: ScreenInspection[],
  current: string | undefined,
  language: Language,
): string {
  const groups = groupScreens(views);
  const sections = groups.map((group) => {
    const title = groups.length > 1 ? groupName(group, language) : LABELS[language].screens;
    const links = group.views.map((view) => navLink(view, current)).join("");
    return `<div class="group">${escapeHtml(title)}</div>\n<nav class="nav">${links}</nav>`;
  });
  return `<aside class="side">
<a class="brand" href="/">tidy<span>spec</span></a>
${sections.join("\n")}
</aside>`;
}

function card(view: ScreenInspection, language: Language): string {
  const summary = view.parsed.spec[0]?.text;
  const desc = summary === undefined ? "" : `<span class="desc">${escapeHtml(summary)}</span>`;
  return `<a class="card" href="${screenHref(view)}"><div><strong>${escapeHtml(screenTitle(view))}</strong>${desc}<span class="path">${escapeHtml(view.screen)}</span></div>${badge(view, language)}</a>`;
}

/** 機能一覧。画面を置かれたディレクトリごとにまとめ、それぞれの仕様の最初の一行を添える。 */
function featureList(views: ScreenInspection[], language: Language): string {
  const groups = groupScreens(views);
  return groups
    .map((group) => {
      const heading = groups.length > 1 ? `<h2>${escapeHtml(groupName(group, language))}</h2>` : "";
      return `${heading}<div class="cards">${group.views.map((view) => card(view, language)).join("")}</div>`;
    })
    .join("\n");
}

/** 画面の一覧。 */
export function renderIndex(inspection: Inspection, language: Language): string {
  const views = inspection.screens;
  const labels = LABELS[language];
  const behind = views.filter(isBehind).length;
  const body =
    views.length === 0
      ? `<p class="lead">${escapeHtml(labels.noScreens)}</p>`
      : `<p class="lead">${escapeHtml(labels.summary(views.length, behind))}</p>\n${featureList(views, language)}`;
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

function dataItems(view: ScreenInspection, schema: Schema | undefined, language: Language): string {
  const missing = new Set(schema === undefined ? [] : selectTables(schema, namesOf(view)).missing);
  const labels = LABELS[language];
  const rows = view.parsed.data.map((item) => {
    const mark = missing.has(item.text)
      ? `<span class="badge warn">${escapeHtml(labels.notInSchema)}</span>`
      : "";
    return `<li>${escapeHtml(item.text)} ${mark}</li>`;
  });
  return `<ul class="items">${rows.join("")}</ul>`;
}

function namesOf(view: ScreenInspection): string[] {
  return view.parsed.data.map((item) => item.text);
}

/** 「データ」の下の ER 図。スキーマが無い、または一つも見つからなければ出さない（名前の一覧だけ）。 */
function erFigure(view: ScreenInspection, schema: Schema | undefined): string {
  if (schema === undefined) return "";
  const svg = renderEr(selectTables(schema, namesOf(view)).found);
  return svg === "" ? "" : `<div class="er-wrap">${svg}</div>`;
}

function section(
  view: ScreenInspection,
  key: SectionKey,
  context: { language: Language; schema: Schema | undefined },
): string {
  const { language, schema } = context;
  const heading = `<h2 id="${key}">${escapeHtml(HEADINGS[language][key])}</h2>`;
  if (key === "code") return heading + codeItems(view, MESSAGES[language]);
  if (key === "data") return heading + dataItems(view, schema, language) + erFigure(view, schema);
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
  inspection: Inspection,
  language: Language,
): string {
  const main = `<main>
<p class="eyebrow">${escapeHtml(LABELS[language].screens)}</p>
<h1>${escapeHtml(screenTitle(view))}</h1>
<div class="meta">${badge(view, language)}<span class="path">${escapeHtml(view.screen)}</span></div>
${problemList(view.problems, language)}
${SECTION_KEYS.map((key) => section(view, key, { language, schema: inspection.schema })).join("\n")}
</main>
${toc(language)}`;
  return shell(
    { title: screenTitle(view), language, current: view.screen },
    inspection.screens,
    main,
  );
}

export function renderNotFound(inspection: Inspection, language: Language): string {
  const labels = LABELS[language];
  const main = `<main><p class="eyebrow">404</p><h1>404</h1><p class="lead"><a href="/">${escapeHtml(labels.back)}</a></p></main>`;
  return shell({ title: "404", language, current: undefined }, inspection.screens, main);
}
