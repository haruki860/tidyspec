import { tableNameOf } from "../checks/schema.js";
import type { ForeignKey, Schema, Table } from "../core/schema.js";
import { sameName } from "../core/schema.js";
import { escapeHtml } from "./escape.js";

/**
 * 画面の「データ」に書いたテーブルと、その間の外部キーだけを、SVG の ER 図にする。
 * 他の画面のテーブルは出さない（SPEC）。親を左、子を右に並べるので、矢印は左から右へ向く。線が交わることはある。
 * 描くのは文字列だけで、名前はすべてエスケープする。色は CSS の変数（style.ts）に任せる。
 */

const BOX_WIDTH = 240;
const HEADER = 34;
const ROW = 24;
const GAP_X = 56;
const GAP_Y = 48;
const PAD = 16;
const MAX_NAME = 14;
const MAX_TYPE = 13;

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

function parentsOf(tables: Table[], child: number): number[] {
  const table = tables[child];
  if (table === undefined) return [];
  const indexes = table.foreignKeys.map((fk) =>
    tables.findIndex((t) => sameName(t.name, fk.table)),
  );
  return indexes.filter((parent) => parent !== -1 && parent !== child);
}

/** 子は、全ての親より右。循環があっても止まるよう、表の数だけ繰り返して打ち切る。 */
function pushChildrenRight(tables: Table[], layers: number[]): void {
  for (let round = 0; round < tables.length; round += 1) {
    tables.forEach((_, child) => {
      for (const parent of parentsOf(tables, child)) {
        const wanted = (layers[parent] ?? 0) + 1;
        layers[child] = Math.min(tables.length - 1, Math.max(layers[child] ?? 0, wanted));
      }
    });
  }
}

/**
 * 親を持たない表は、いちばん近い子の隣まで右へ寄せる。
 * 寄せないと、遠い子への線が、間にある別の表の箱の裏を通って読めなくなる。
 */
function pullSourcesRight(tables: Table[], layers: number[]): void {
  tables.forEach((_, source) => {
    if (parentsOf(tables, source).length > 0) return;
    const childLayers = tables.flatMap((__, child) =>
      parentsOf(tables, child).includes(source) ? [layers[child] ?? 0] : [],
    );
    if (childLayers.length > 0) layers[source] = Math.max(0, Math.min(...childLayers) - 1);
  });
}

/** 親（参照される側）を左、子（外部キーを持つ側）を右に置くための、左から数えた列の番号。 */
function layersOf(tables: Table[]): number[] {
  const layers = tables.map(() => 0);
  pushChildrenRight(tables, layers);
  pullSourcesRight(tables, layers);
  return layers;
}

/** 列ごとに、「データ」に書いた順で縦に並べる。 */
function layout(tables: Table[]): Box[] {
  const layers = layersOf(tables);
  const nextY = new Map<number, number>();
  return tables.map((table, i) => {
    const layer = layers[i] ?? 0;
    const y = nextY.get(layer) ?? PAD;
    const height = HEADER + Math.max(1, table.columns.length) * ROW;
    nextY.set(layer, y + height + GAP_Y);
    return { table, x: PAD + layer * (BOX_WIDTH + GAP_X), y, height };
  });
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

/**
 * 横の位置が違えば向かい合う辺から、同じ列なら同じ側の辺から出て、外へふくらむ曲線にする。
 * 矢印は、参照される表（親）から、外部キーを持つ表（子）へ向ける。「親が子を持つ」と読める向き。
 * 線は子の側から描き始めるので、矢じりは線の始点に付ける。
 */
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
  return `<path class="er-line" d="M${startX} ${startY} C${startX + out} ${startY} ${endX + into} ${endY} ${endX} ${endY}" marker-start="url(#er-arrow)"/>`;
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
<defs><marker id="er-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path class="er-arrow" d="M0 0 L10 5 L0 10 z"/></marker></defs>
${renderEdges(boxes)}${boxes.map(renderBox).join("")}
</svg>`;
}
