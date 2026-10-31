import { tableNameOf } from "../checks/schema.js";
import type { ForeignKey, Schema, Table } from "../core/schema.js";
import { sameName } from "../core/schema.js";
import { escapeHtml } from "./escape.js";

/**
 * 画面の「データ」に書いたテーブルと、その間の外部キーだけを、SVG の ER 図にする。
 * 他の画面のテーブルは出さない（SPEC）。レイアウトは格子に並べるだけで、線が交わることはある。
 * 描くのは文字列だけで、名前はすべてエスケープする。色は CSS の変数（style.ts）に任せる。
 */

const BOX_WIDTH = 248;
const HEADER = 34;
const ROW = 24;
const GAP_X = 80;
const GAP_Y = 48;
const PAD = 16;
const COLUMNS_PER_ROW = 2;
const MAX_NAME = 17;
const MAX_TYPE = 16;

interface Box {
  table: Table;
  x: number;
  y: number;
  height: number;
}

/** 「データ」の並びの順で、スキーマにあるテーブルと、無かった名前に分ける。 */
export function selectTables(
  schema: Schema,
  names: string[],
): { found: Table[]; missing: string[] } {
  const found: Table[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const table = schema.tables.find((candidate) => sameName(candidate.name, tableNameOf(name)));
    if (table === undefined) missing.push(name);
    else if (!found.includes(table)) found.push(table);
  }
  return { found, missing };
}

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function layout(tables: Table[]): Box[] {
  const heights = tables.map((table) => HEADER + Math.max(1, table.columns.length) * ROW);
  const boxes: Box[] = [];
  let y = PAD;
  for (let start = 0; start < tables.length; start += COLUMNS_PER_ROW) {
    const rowHeights = heights.slice(start, start + COLUMNS_PER_ROW);
    tables.slice(start, start + COLUMNS_PER_ROW).forEach((table, i) => {
      boxes.push({
        table,
        x: PAD + i * (BOX_WIDTH + GAP_X),
        y,
        height: heights[start + i] ?? HEADER,
      });
    });
    y += Math.max(...rowHeights) + GAP_Y;
  }
  return boxes;
}

function foreignKeyColumns(table: Table): Set<string> {
  return new Set(table.foreignKeys.flatMap((fk) => fk.columns.map((c) => c.toLowerCase())));
}

function rowMark(primaryKey: boolean, foreign: boolean): string {
  if (primaryKey) return "PK";
  return foreign ? "FK" : "";
}

function renderBox(box: Box): string {
  const { table, x, y, height } = box;
  const foreign = foreignKeyColumns(table);
  const rows = table.columns.map((column, i) => {
    const top = y + HEADER + i * ROW;
    const mark = rowMark(column.primaryKey, foreign.has(column.name.toLowerCase()));
    return [
      `<text class="er-mark" x="${x + 10}" y="${top + 16}">${mark}</text>`,
      `<text class="er-name" x="${x + 36}" y="${top + 16}">${escapeHtml(shorten(column.name, MAX_NAME))}</text>`,
      `<text class="er-type" x="${x + BOX_WIDTH - 10}" y="${top + 16}" text-anchor="end">${escapeHtml(shorten(column.type, MAX_TYPE))}</text>`,
    ].join("");
  });
  return [
    `<rect class="er-box" x="${x}" y="${y}" width="${BOX_WIDTH}" height="${height}" rx="10"/>`,
    `<text class="er-title" x="${x + 12}" y="${y + 22}">${escapeHtml(shorten(table.name, 26))}</text>`,
    `<line class="er-rule" x1="${x}" y1="${y + HEADER}" x2="${x + BOX_WIDTH}" y2="${y + HEADER}"/>`,
    ...rows,
  ].join("");
}

/** 外部キーの列の行の、縦の真ん中。列が見つからなければ見出しの真ん中。 */
function rowCenter(box: Box, columnName: string | undefined): number {
  const index = box.table.columns.findIndex(
    (column) => columnName !== undefined && sameName(column.name, columnName),
  );
  return index === -1 ? box.y + HEADER / 2 : box.y + HEADER + index * ROW + ROW / 2;
}

function referencedColumn(target: Box, foreignKey: ForeignKey): string | undefined {
  return foreignKey.refColumns[0] ?? target.table.columns.find((column) => column.primaryKey)?.name;
}

function sideX(box: Box, side: "left" | "right"): number {
  return side === "right" ? box.x + BOX_WIDTH : box.x;
}

/** 横の位置が違えば向かい合う辺から、同じ列なら同じ側の辺から出て、外へふくらむ曲線にする。 */
function renderEdge(from: Box, to: Box, foreignKey: ForeignKey): string {
  const sameColumn = from.x === to.x;
  const rightward = to.x > from.x || sameColumn;
  const startX = sideX(from, rightward ? "right" : "left");
  const endX = sideX(to, sameColumn || !rightward ? "right" : "left");
  const startY = rowCenter(from, foreignKey.columns[0]);
  const endY = rowCenter(to, referencedColumn(to, foreignKey));
  const bulge = sameColumn ? 56 : GAP_X / 2;
  const out = rightward ? bulge : -bulge;
  const into = sameColumn ? bulge : -out;
  return `<path class="er-line" d="M${startX} ${startY} C${startX + out} ${startY} ${endX + into} ${endY} ${endX} ${endY}" marker-end="url(#er-arrow)"/>`;
}

function renderEdges(boxes: Box[]): string {
  const edges: string[] = [];
  for (const from of boxes) {
    for (const foreignKey of from.table.foreignKeys) {
      const to = boxes.find((box) => sameName(box.table.name, foreignKey.table));
      if (to !== undefined && to !== from) edges.push(renderEdge(from, to, foreignKey));
    }
  }
  return edges.join("");
}

/** 図の SVG。テーブルが無ければ空の文字列。 */
export function renderEr(tables: Table[]): string {
  if (tables.length === 0) return "";
  const boxes = layout(tables);
  const width = Math.max(...boxes.map((box) => box.x + BOX_WIDTH)) + PAD;
  const height = Math.max(...boxes.map((box) => box.y + box.height)) + PAD;
  return `<svg class="er" viewBox="0 0 ${width} ${height}" width="${width}" role="img">
<defs><marker id="er-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path class="er-arrow" d="M0 0 L10 5 L0 10 z"/></marker></defs>
${renderEdges(boxes)}${boxes.map(renderBox).join("")}
</svg>`;
}
