import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_LANGUAGE, isLanguage, LANGUAGES, type Language } from "./core/language.js";

export const CONFIG_FILE = "tidyspec.json";

export interface Config {
  /** 画面の Markdown。git の glob 形式 */
  screens: string[];
  /** 実装ファイル。「未登録」を知らせるためだけに使い、止めるかどうかには関わらない */
  implementation: string[];
  maxLineLength?: number;
  /** ER 図の元にする SQL（マイグレーション）。git の glob 形式。ファイル名の順に、古い順として読む */
  schema: string[];
  /** 画面ファイルの見出しと、指摘の文言の言語 */
  language: Language;
}

// 画面の置き場、実装、スキーマのパターンは SPEC に無いので、仮の既定値。
// スキーマは Supabase、drizzle、Prisma のマイグレーションの置き場から探す。
export const DEFAULT_CONFIG: Config = {
  screens: ["docs/screens/**/*.md"],
  implementation: ["src/**", "app/**"],
  schema: [
    "supabase/migrations/**/*.sql",
    "drizzle/**/*.sql",
    "prisma/migrations/**/*.sql",
    "db/**/*.sql",
  ],
  language: DEFAULT_LANGUAGE,
};

export type ConfigResult = { ok: true; config: Config } | { ok: false; error: string };

const KNOWN_KEYS = ["screens", "implementation", "schema", "maxLineLength", "language"];

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "")
  );
}

type Field<T> = { ok: true; value: T } | { ok: false; error: string };

function invalid(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

// noPropertyAccessFromIndexSignature があるので、キーを分割代入で取り出す。
function destructure(record: Record<string, unknown>) {
  const { screens, implementation, schema, maxLineLength, language } = record;
  return { screens, implementation, schema, maxLineLength, language };
}

function jsonObject(text: string): Field<Record<string, unknown>> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalid(`${CONFIG_FILE} is not valid JSON`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(`${CONFIG_FILE} must be a JSON object`);
  }
  return { ok: true, value: Object.fromEntries(Object.entries(value)) };
}

// 以降の項目の読み取りは、書かれていなければ既定値を返す。

function screensField(value: unknown): Field<string[]> {
  if (value === undefined) return { ok: true, value: DEFAULT_CONFIG.screens };
  if (!isStringArray(value) || value.length === 0) {
    return invalid("screens must be a non-empty array of strings");
  }
  return { ok: true, value };
}

function implementationField(value: unknown): Field<string[]> {
  if (value === undefined) return { ok: true, value: DEFAULT_CONFIG.implementation };
  if (!isStringArray(value)) return invalid("implementation must be an array of strings");
  return { ok: true, value };
}

function schemaField(value: unknown): Field<string[]> {
  if (value === undefined) return { ok: true, value: DEFAULT_CONFIG.schema };
  if (!isStringArray(value)) return invalid("schema must be an array of strings");
  return { ok: true, value };
}

function maxLineLengthField(value: unknown): Field<number | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return invalid("maxLineLength must be an integer of 1 or more");
  }
  return { ok: true, value };
}

function languageField(value: unknown): Field<Language> {
  if (value === undefined) return { ok: true, value: DEFAULT_CONFIG.language };
  if (!isLanguage(value)) return invalid(`language must be one of: ${LANGUAGES.join(", ")}`);
  return { ok: true, value };
}

/**
 * 設定の JSON を検証する。書かれていない項目は既定値で埋める。
 * 打ち間違いのキーは、黙って無視すると検査が効かないままになるので、エラーにする。
 */
export function parseConfig(text: string): ConfigResult {
  const parsed = jsonObject(text);
  if (!parsed.ok) return parsed;
  const record = parsed.value;
  const fields = destructure(record);

  const unknown = Object.keys(record).filter((key) => !KNOWN_KEYS.includes(key));
  if (unknown.length > 0) return invalid(`${CONFIG_FILE} has unknown keys: ${unknown.join(", ")}`);

  const screens = screensField(fields.screens);
  if (!screens.ok) return screens;
  const implementation = implementationField(fields.implementation);
  if (!implementation.ok) return implementation;
  const schema = schemaField(fields.schema);
  if (!schema.ok) return schema;
  const maxLineLength = maxLineLengthField(fields.maxLineLength);
  if (!maxLineLength.ok) return maxLineLength;
  const language = languageField(fields.language);
  if (!language.ok) return language;

  const config: Config = {
    screens: screens.value,
    implementation: implementation.value,
    schema: schema.value,
    language: language.value,
    ...(maxLineLength.value === undefined ? {} : { maxLineLength: maxLineLength.value }),
  };
  return { ok: true, config };
}

/** repo のルートにある設定を読む。ファイルが無ければ既定値。 */
export async function loadConfig(repo: string): Promise<ConfigResult> {
  let text: string;
  try {
    text = await readFile(path.join(repo, CONFIG_FILE), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { ok: true, config: { ...DEFAULT_CONFIG } };
    }
    return { ok: false, error: `cannot read ${CONFIG_FILE}` };
  }
  return parseConfig(text);
}
