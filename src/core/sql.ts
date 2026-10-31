import type { Column, ForeignKey, Schema, Table } from "./schema.js";
import { sameName } from "./schema.js";
import { isSymbol, isWord, splitStatements, type Token, tokenize } from "./sqlTokens.js";

/**
 * SQL の `CREATE TABLE`、`ALTER TABLE`、`DROP TABLE` を読んで、テーブルと外部キーを取り出す。
 * Postgres と SQLite（drizzle、Supabase のマイグレーション）で見かける形だけを読み、
 * 読めない文は黙って飛ばす（インデックス、関数、ポリシーなど、ER 図に要らないものが大半のため）。
 */

/** 先頭から順に読み進める、トークンの読み取り位置。 */
class Cursor {
  private position = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek(): Token | undefined {
    return this.tokens[this.position];
  }

  done(): boolean {
    return this.position >= this.tokens.length;
  }

  /** 一つ読み進めて、そのトークンを返す。 */
  next(): Token | undefined {
    const token = this.peek();
    if (token !== undefined) this.position += 1;
    return token;
  }

  /** 次が指定のキーワードなら、読み進めて true。 */
  word(word: string): boolean {
    if (!isWord(this.peek(), word)) return false;
    this.position += 1;
    return true;
  }

  symbol(text: string): boolean {
    if (!isSymbol(this.peek(), text)) return false;
    this.position += 1;
    return true;
  }

  /** 名前（単語か、引用符つき）を一つ読む。 */
  ident(): string | undefined {
    const token = this.peek();
    if (token?.kind !== "word" && token?.kind !== "quoted") return undefined;
    this.position += 1;
    return token.text;
  }

  /** `a.b.c` のような修飾つきの名前を読んで、最後の部分を返す（スキーマ名は ER 図に要らない）。 */
  qualifiedName(): string | undefined {
    let name = this.ident();
    while (name !== undefined && this.symbol(".")) name = this.ident() ?? name;
    return name;
  }

  /** 残りのトークン。 */
  rest(): Token[] {
    return this.tokens.slice(this.position);
  }

  /** `( ... )` を、対応する閉じ括弧まで読み、中のトークンを返す。開き括弧が無ければ undefined。 */
  parenthesized(): Token[] | undefined {
    if (!this.symbol("(")) return undefined;
    const inner: Token[] = [];
    let depth = 1;
    while (!this.done()) {
      const token = this.tokens[this.position];
      this.position += 1;
      if (isSymbol(token, "(")) depth += 1;
      if (isSymbol(token, ")")) depth -= 1;
      if (depth === 0) break;
      if (token !== undefined) inner.push(token);
    }
    return inner;
  }
}

/** 括弧の外のカンマで分ける。 */
function splitTopLevel(tokens: Token[]): Token[][] {
  const parts: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (isSymbol(token, "(")) depth += 1;
    if (isSymbol(token, ")")) depth -= 1;
    if (isSymbol(token, ",") && depth === 0) {
      parts.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

/** `(a, "b")` の中の名前の並び。 */
function nameList(inner: Token[] | undefined): string[] {
  if (inner === undefined) return [];
  return splitTopLevel(inner).flatMap((part) => new Cursor(part).ident() ?? []);
}

/** `REFERENCES t [(c, ...)]` の `REFERENCES` のあと。 */
function readReference(cursor: Cursor, columns: string[]): ForeignKey | undefined {
  const table = cursor.qualifiedName();
  if (table === undefined) return undefined;
  return { columns, table, refColumns: nameList(cursor.parenthesized()) };
}

// 型の終わりを示す語。これ以降は列の制約として読む。
const COLUMN_CONSTRAINT_WORDS = new Set([
  "not",
  "null",
  "default",
  "primary",
  "references",
  "unique",
  "check",
  "constraint",
  "generated",
  "collate",
  "as",
]);

function startsConstraint(token: Token | undefined): boolean {
  return token?.kind === "word" && COLUMN_CONSTRAINT_WORDS.has(token.text.toLowerCase());
}

function tokenText(token: Token): string {
  return token.kind === "word" || token.kind === "symbol" || token.kind === "quoted"
    ? token.text
    : "";
}

// この記号のすぐ後ろには、空白を入れない（`numeric(10,2)`、`text[]`）。
const NO_SPACE_AFTER = new Set(["(", "[", ","]);

/** 型を表す語と括弧を、`varchar(255)`、`double precision`、`text[]` のような文字列にする。 */
function typeText(tokens: Token[]): string {
  let text = "";
  let previous: Token | undefined;
  for (const token of tokens) {
    const part = tokenText(token);
    const afterOpening = previous?.kind === "symbol" && NO_SPACE_AFTER.has(previous.text);
    const spaced = token.kind !== "symbol" && previous !== undefined && !afterOpening;
    text += spaced ? ` ${part}` : part;
    previous = token;
  }
  return text;
}

function readType(cursor: Cursor): string {
  const tokens: Token[] = [];
  while (!cursor.done() && !startsConstraint(cursor.peek())) {
    if (isSymbol(cursor.peek(), "(")) {
      const inner = cursor.parenthesized() ?? [];
      tokens.push({ kind: "symbol", text: "(" }, ...inner, { kind: "symbol", text: ")" });
    } else {
      const token = cursor.next();
      if (token !== undefined) tokens.push(token);
    }
  }
  return typeText(tokens);
}

/** 型のあとの制約を一つ読む。参照ならその外部キーを返す。知らないものは一つ読み飛ばす。 */
function readColumnConstraint(cursor: Cursor, column: Column): ForeignKey | undefined {
  if (cursor.word("not") && cursor.word("null")) {
    column.notNull = true;
  } else if (cursor.word("primary") && cursor.word("key")) {
    column.primaryKey = true;
    column.notNull = true;
  } else if (cursor.word("references")) {
    return readReference(cursor, [column.name]);
  } else if (isSymbol(cursor.peek(), "(")) {
    cursor.parenthesized();
  } else {
    cursor.next();
  }
  return undefined;
}

/** 型のあとの制約を全て読む。ER 図に要るのは、主キー、NOT NULL、参照だけ。 */
function readColumnConstraints(cursor: Cursor, column: Column): ForeignKey | undefined {
  let reference: ForeignKey | undefined;
  while (!cursor.done()) reference = readColumnConstraint(cursor, column) ?? reference;
  return reference;
}

function readColumn(
  cursor: Cursor,
): { column: Column; reference: ForeignKey | undefined } | undefined {
  const name = cursor.ident();
  if (name === undefined) return undefined;
  const column: Column = { name, type: readType(cursor), primaryKey: false, notNull: false };
  return { column, reference: readColumnConstraints(cursor, column) };
}

/** `FOREIGN KEY (a, b) REFERENCES t (c, d)` の `KEY` のあと。 */
function readForeignKey(cursor: Cursor): ForeignKey | undefined {
  const columns = nameList(cursor.parenthesized());
  return cursor.word("references") ? readReference(cursor, columns) : undefined;
}

// 列ではない、ER 図に要らない制約。
const IGNORED_CONSTRAINTS = ["unique", "check", "exclude"];

function isIgnoredConstraint(cursor: Cursor): boolean {
  const token = cursor.peek();
  return token?.kind === "word" && IGNORED_CONSTRAINTS.includes(token.text.toLowerCase());
}

function markPrimaryKey(table: Table, names: string[]): void {
  for (const column of table.columns) {
    if (names.some((name) => sameName(name, column.name))) {
      column.primaryKey = true;
      column.notNull = true;
    }
  }
}

/** 表の制約（主キー、外部キー）なら読んでテーブルに足し、true を返す。 */
function applyConstraint(table: Table, cursor: Cursor): boolean {
  if (cursor.word("primary") && cursor.word("key")) {
    markPrimaryKey(table, nameList(cursor.parenthesized()));
    return true;
  }
  if (cursor.word("foreign") && cursor.word("key")) {
    const foreignKey = readForeignKey(cursor);
    if (foreignKey) table.foreignKeys.push(foreignKey);
    return true;
  }
  return false;
}

function applyColumn(table: Table, cursor: Cursor): void {
  const read = readColumn(cursor);
  if (read === undefined) return;
  table.columns.push(read.column);
  if (read.reference) table.foreignKeys.push(read.reference);
}

/** テーブルの定義の一項目（列、または表の制約）をテーブルに足す。 */
function applyItem(table: Table, tokens: Token[]): void {
  const cursor = new Cursor(tokens);
  const named = cursor.word("constraint");
  if (named) cursor.ident();
  if (applyConstraint(table, cursor)) return;
  // CONSTRAINT で始まって主キーでも外部キーでもないもの（UNIQUE、CHECK）は、列ではない。
  if (named || isIgnoredConstraint(cursor)) return;
  applyColumn(table, cursor);
}

type Tables = Map<string, Table>;

const key = (name: string): string => name.toLowerCase();

/** `CREATE [TEMP] TABLE [IF NOT EXISTS] name ( ... )` の `CREATE` のあと。 */
function applyCreate(tables: Tables, cursor: Cursor): void {
  while (["global", "local", "temp", "temporary", "unlogged"].some((w) => cursor.word(w)));
  if (!cursor.word("table")) return;
  skipIfNotExists(cursor);
  const name = cursor.qualifiedName();
  const body = cursor.parenthesized();
  if (name === undefined || body === undefined) return;
  const table: Table = { name, columns: [], foreignKeys: [] };
  for (const item of splitTopLevel(body)) applyItem(table, item);
  tables.set(key(name), table);
}

/** `ALTER TABLE [IF EXISTS] [ONLY] name ADD ...` の `ALTER` のあと。 */
function applyAlter(tables: Tables, cursor: Cursor): void {
  if (!cursor.word("table")) return;
  if (cursor.word("if")) cursor.word("exists");
  cursor.word("only");
  const name = cursor.qualifiedName();
  const table = name === undefined ? undefined : tables.get(key(name));
  if (table === undefined) return;
  for (const action of splitTopLevel(cursor.rest())) applyAlterAction(table, new Cursor(action));
}

function skipIfNotExists(cursor: Cursor): void {
  if (!cursor.word("if")) return;
  cursor.word("not");
  cursor.word("exists");
}

function dropColumn(table: Table, cursor: Cursor): void {
  if (cursor.word("if")) cursor.word("exists");
  const name = cursor.ident();
  if (name === undefined) return;
  table.columns = table.columns.filter((column) => !sameName(column.name, name));
  table.foreignKeys = table.foreignKeys.filter((fk) => !fk.columns.some((c) => sameName(c, name)));
}

function applyAlterAction(table: Table, cursor: Cursor): void {
  if (cursor.word("add")) {
    cursor.word("column");
    skipIfNotExists(cursor);
    applyItem(table, cursor.rest());
  } else if (cursor.word("drop") && cursor.word("column")) {
    dropColumn(table, cursor);
  }
}

/** `DROP TABLE [IF EXISTS] a, b` の `DROP` のあと。 */
function applyDrop(tables: Tables, cursor: Cursor): void {
  if (!cursor.word("table")) return;
  if (cursor.word("if")) cursor.word("exists");
  for (const part of splitTopLevel(cursor.rest())) {
    const name = new Cursor(part).qualifiedName();
    if (name !== undefined) tables.delete(key(name));
  }
}

function applyStatement(tables: Tables, tokens: Token[]): void {
  const cursor = new Cursor(tokens);
  if (cursor.word("create")) applyCreate(tables, cursor);
  else if (cursor.word("alter")) applyAlter(tables, cursor);
  else if (cursor.word("drop")) applyDrop(tables, cursor);
}

/**
 * SQL のファイルの中身を、与えられた順に実行したものとして、できあがりのスキーマを返す。
 * マイグレーションは古い順に並べて渡す。
 */
export function parseSchema(sources: string[]): Schema {
  const tables: Tables = new Map();
  for (const source of sources) {
    for (const statement of splitStatements(tokenize(source))) applyStatement(tables, statement);
  }
  return { tables: [...tables.values()] };
}
