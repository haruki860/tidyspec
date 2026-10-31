/**
 * SQL を、読み取りに要る最小の単位に分ける。コメントは捨てる。
 * 文字列と引用符つきの名前の中の `;` や `,` を、区切りと取り違えないための段階。
 */
export type Token =
  | { kind: "word"; text: string }
  | { kind: "quoted"; text: string }
  | { kind: "string" }
  | { kind: "symbol"; text: string };

const WORD = /[A-Za-z0-9_$\u0080-￿]/;

function skipLineComment(sql: string, from: number): number {
  const end = sql.indexOf("\n", from);
  return end === -1 ? sql.length : end;
}

function skipBlockComment(sql: string, from: number): number {
  const end = sql.indexOf("*/", from + 2);
  return end === -1 ? sql.length : end + 2;
}

/** 開き記号の次から、閉じ記号（二つ重ねは中の一文字）までを読む。閉じが無ければ末尾まで。 */
function readQuoted(sql: string, from: number, close: string): { text: string; next: number } {
  let text = "";
  let i = from + 1;
  while (i < sql.length) {
    if (sql[i] === close) {
      if (sql[i + 1] !== close) return { text, next: i + 1 };
      text += close;
      i += 2;
    } else {
      text += sql[i];
      i += 1;
    }
  }
  return { text, next: sql.length };
}

/** `$$ ... $$` や `$tag$ ... $tag$`（関数の本体など）を一つの文字列として飛ばす。 */
function dollarQuoteEnd(sql: string, from: number): number | undefined {
  const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(from))?.[0];
  if (tag === undefined) return undefined;
  const end = sql.indexOf(tag, from + tag.length);
  return end === -1 ? sql.length : end + tag.length;
}

// `text[]` の `[` は、SQLite などの `[名前]` の引用ではなく配列の型。直前が名前や `)` ならそう読む。
function isArraySuffix(sql: string, at: number): boolean {
  const before = sql[at - 1] ?? "";
  return WORD.test(before) || before === ")" || before === "]";
}

/** 空白とコメントを飛ばして、次の読み始めの位置を返す。 */
function skipTrivia(sql: string, from: number): number {
  let i = from;
  while (i < sql.length) {
    const c = sql[i] ?? "";
    if (/\s/.test(c)) i += 1;
    else if (sql.startsWith("--", i)) i = skipLineComment(sql, i);
    else if (sql.startsWith("/*", i)) i = skipBlockComment(sql, i);
    else break;
  }
  return i;
}

function readWord(sql: string, from: number): { token: Token; next: number } {
  let end = from;
  while (end < sql.length && WORD.test(sql[end] ?? "")) end += 1;
  return { token: { kind: "word", text: sql.slice(from, end) }, next: end };
}

/** 空白とコメントを飛ばしたあとの位置から、一つ読む。 */
function readToken(sql: string, from: number): { token: Token; next: number } {
  const c = sql[from] ?? "";
  if (c === "'") return { token: { kind: "string" }, next: readQuoted(sql, from, "'").next };
  const dollarEnd = c === "$" ? dollarQuoteEnd(sql, from) : undefined;
  if (dollarEnd !== undefined) return { token: { kind: "string" }, next: dollarEnd };
  if (c === '"' || c === "`" || (c === "[" && !isArraySuffix(sql, from))) {
    const read = readQuoted(sql, from, c === "[" ? "]" : c);
    return { token: { kind: "quoted", text: read.text }, next: read.next };
  }
  if (WORD.test(c)) return readWord(sql, from);
  return { token: { kind: "symbol", text: c }, next: from + 1 };
}

export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = skipTrivia(sql, 0);
  while (i < sql.length) {
    const read = readToken(sql, i);
    tokens.push(read.token);
    i = skipTrivia(sql, read.next);
  }
  return tokens;
}

/** 括弧の外の `;` で文に分ける。 */
export function splitStatements(tokens: Token[]): Token[][] {
  const statements: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.kind === "symbol" && token.text === ";") {
      if (current.length > 0) statements.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length > 0) statements.push(current);
  return statements;
}

export function isSymbol(token: Token | undefined, text: string): boolean {
  return token?.kind === "symbol" && token.text === text;
}

/** 引用符なしの単語がキーワードと一致するか（大文字小文字は区別しない）。 */
export function isWord(token: Token | undefined, word: string): boolean {
  return token?.kind === "word" && token.text.toLowerCase() === word;
}
