import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_HOOK_CONFIG, type HookConfig } from "./hook.js";
import { isLanguage, LANGUAGES } from "./language.js";

export const CONFIG_FILE = "tidyspec.json";

export type ConfigResult = { ok: true; config: HookConfig } | { ok: false; error: string };

const KNOWN_KEYS = ["screens", "implementation", "maxLineLength", "language"];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "");
}

/**
 * 設定の JSON を検証する。書かれていない項目は既定値で埋める。
 * 打ち間違いのキーは、黙って無視すると検査が効かないままになるので、エラーにする。
 */
export function parseConfig(text: string): ConfigResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: `${CONFIG_FILE} is not valid JSON` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: `${CONFIG_FILE} must be a JSON object` };
  }
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));

  const unknown = Object.keys(record).filter((key) => !KNOWN_KEYS.includes(key));
  if (unknown.length > 0) {
    return { ok: false, error: `${CONFIG_FILE} has unknown keys: ${unknown.join(", ")}` };
  }

  const config: HookConfig = { ...DEFAULT_HOOK_CONFIG };

  const { screens, implementation, maxLineLength, language } = record;
  if (screens !== undefined) {
    if (!isStringArray(screens) || screens.length === 0) {
      return { ok: false, error: "screens must be a non-empty array of strings" };
    }
    config.screens = screens;
  }
  if (implementation !== undefined) {
    if (!isStringArray(implementation)) {
      return { ok: false, error: "implementation must be an array of strings" };
    }
    config.implementation = implementation;
  }
  if (maxLineLength !== undefined) {
    if (typeof maxLineLength !== "number" || !Number.isInteger(maxLineLength) || maxLineLength < 1) {
      return { ok: false, error: "maxLineLength must be an integer of 1 or more" };
    }
    config.maxLineLength = maxLineLength;
  }
  if (language !== undefined) {
    if (!isLanguage(language)) {
      return { ok: false, error: `language must be one of: ${LANGUAGES.join(", ")}` };
    }
    config.language = language;
  }
  return { ok: true, config };
}

/** repo のルートにある設定を読む。ファイルが無ければ既定値。 */
export async function loadConfig(repo: string): Promise<ConfigResult> {
  let text: string;
  try {
    text = await readFile(path.join(repo, CONFIG_FILE), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return { ok: true, config: { ...DEFAULT_HOOK_CONFIG } };
    }
    return { ok: false, error: `cannot read ${CONFIG_FILE}` };
  }
  return parseConfig(text);
}
