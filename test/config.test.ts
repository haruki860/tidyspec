import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_FILE, DEFAULT_CONFIG, loadConfig, parseConfig } from "../src/config.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function errorOf(text: string) {
  const result = parseConfig(text);
  return result.ok ? null : result.error;
}

describe("parseConfig", () => {
  it("空のオブジェクトは既定値", () => {
    expect(parseConfig("{}")).toEqual({ ok: true, config: DEFAULT_CONFIG });
  });

  it("書いた項目だけ上書きする", () => {
    const result = parseConfig('{"screens":["specs/*.md"],"maxLineLength":60}');
    expect(result).toEqual({
      ok: true,
      config: { ...DEFAULT_CONFIG, screens: ["specs/*.md"], maxLineLength: 60 },
    });
  });

  it("language を選べる。既定は英語", () => {
    expect(parseConfig('{"language":"ja"}')).toMatchObject({
      ok: true,
      config: { language: "ja" },
    });
    expect(parseConfig("{}")).toMatchObject({ ok: true, config: { language: "en" } });
  });

  it("implementation は空の配列でもよい（未登録の通知を使わない）", () => {
    expect(parseConfig('{"implementation":[]}')).toMatchObject({
      ok: true,
      config: { implementation: [] },
    });
  });

  it.each([
    ["JSON でない", "{oops", "not valid JSON"],
    ["配列", "[]", "JSON object"],
    ["null", "null", "JSON object"],
    ["打ち間違いのキー", '{"screen":["a"]}', "unknown keys: screen"],
    ["screens が空", '{"screens":[]}', "screens"],
    ["screens が文字列", '{"screens":"a"}', "screens"],
    ["screens に空文字", '{"screens":[" "]}', "screens"],
    ["implementation に数値", '{"implementation":[1]}', "implementation"],
    ["maxLineLength が小数", '{"maxLineLength":1.5}', "maxLineLength"],
    ["maxLineLength が 0", '{"maxLineLength":0}', "maxLineLength"],
    ["maxLineLength が文字列", '{"maxLineLength":"80"}', "maxLineLength"],
    ["language が知らない言語", '{"language":"fr"}', "language must be one of: en, ja"],
    ["language が文字列でない", '{"language":1}', "language"],
  ])("%s はエラー", (_name, text, message) => {
    expect(errorOf(text)).toContain(message);
  });
});

describe("loadConfig", () => {
  function tempDir() {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tidyspec-config-")));
    dirs.push(dir);
    return dir;
  }

  it("設定ファイルが無ければ既定値", async () => {
    expect(await loadConfig(tempDir())).toEqual({ ok: true, config: DEFAULT_CONFIG });
  });

  it("ファイルを読む", async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, CONFIG_FILE), '{"maxLineLength":50}');
    expect(await loadConfig(dir)).toMatchObject({ ok: true, config: { maxLineLength: 50 } });
  });

  it("壊れた設定は、既定値に戻さずエラーにする", async () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, CONFIG_FILE), "{oops");
    expect(await loadConfig(dir)).toMatchObject({ ok: false });
  });
});
