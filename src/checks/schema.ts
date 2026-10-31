import path from "node:path";
import type { Config } from "../config.js";
import type { Schema } from "../core/schema.js";
import { sameName } from "../core/schema.js";
import { parseSchema } from "../core/sql.js";
import { listProjectFiles, readRegularFile } from "../repo/files.js";

/**
 * 設定の schema に合う SQL を、ファイル名の順（マイグレーションなら古い順）に読んで、
 * できあがりのスキーマを返す。該当するファイルが一つも無ければ undefined（スキーマが無い）。
 */
export async function loadSchema(repo: string, config: Config): Promise<Schema | undefined> {
  if (config.schema.length === 0) return undefined;
  const files = await listProjectFiles(repo, config.schema);
  const sources: string[] = [];
  for (const file of files) {
    const text = await readRegularFile(path.join(repo, file));
    if (text !== undefined) sources.push(text);
  }
  return sources.length === 0 ? undefined : parseSchema(sources);
}

/** 画面の「データ」に書いた名前から、`public.users` のようなスキーマ名の接頭辞を除く。 */
export function tableNameOf(item: string): string {
  return item.slice(item.lastIndexOf(".") + 1);
}

export function hasTable(schema: Schema, item: string): boolean {
  const name = tableNameOf(item);
  return schema.tables.some((table) => sameName(table.name, name));
}
