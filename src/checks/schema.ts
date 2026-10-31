import path from "node:path";
import type { Config } from "../config.js";
import type { ParsedScreen, Problem } from "../core/parse.js";
import type { Schema } from "../core/schema.js";
import { sameName } from "../core/schema.js";
import { parseSchema } from "../core/sql.js";
import { listProjectFiles, readRegularFile } from "../repo/files.js";

/**
 * SQL のファイルを、渡された順（マイグレーションなら古い順）に読んで、できあがりのスキーマを返す。
 * 読めたファイルが一つも無ければ undefined（スキーマが無い）。
 */
export async function schemaFrom(
  files: string[],
  read: (file: string) => Promise<string | undefined>,
): Promise<Schema | undefined> {
  const sources: string[] = [];
  for (const file of files) {
    const text = await read(file);
    if (text !== undefined) sources.push(text);
  }
  return sources.length === 0 ? undefined : parseSchema(sources);
}

/** 設定の schema に合う、作業ツリーの SQL からスキーマを作る。 */
export async function loadSchema(repo: string, config: Config): Promise<Schema | undefined> {
  if (config.schema.length === 0) return undefined;
  const files = await listProjectFiles(repo, config.schema);
  return schemaFrom(files, (file) => readRegularFile(path.join(repo, file)));
}

/** 画面の「データ」に書いた名前から、`public.users` のようなスキーマ名の接頭辞を除く。 */
export function tableNameOf(item: string): string {
  return item.slice(item.lastIndexOf(".") + 1);
}

export function hasTable(schema: Schema, item: string): boolean {
  const name = tableNameOf(item);
  return schema.tables.some((table) => sameName(table.name, name));
}

// スキーマがあるのに、「データ」に書いたテーブルがそこに無いのは、書き間違いか消し忘れ。
export function dataProblems(parsed: ParsedScreen, schema: Schema | undefined): Problem[] {
  if (schema === undefined) return [];
  return parsed.data
    .filter((item) => !hasTable(schema, item.text))
    .map((item) => ({ kind: "table-not-in-schema", line: item.line, detail: item.text }));
}
