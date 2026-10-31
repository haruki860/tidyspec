import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectProject } from "../src/checks/status.js";
import { DEFAULT_CONFIG, parseConfig } from "../src/config.js";
import { parseSchema } from "../src/core/sql.js";
import { renderEr, selectTables } from "../src/preview/er.js";
import { renderScreenPage } from "../src/preview/html.js";
import { TestRepo } from "./helpers/repo.js";

const made: TestRepo[] = [];
afterEach(() => {
  for (const repo of made.splice(0)) repo.remove();
});

const MIGRATION = `
create table users (id uuid primary key, email text not null);
create table sessions (id uuid primary key, user_id uuid not null references users(id));
create table books (id bigint primary key, title text);
`;

const screen = (data: string[]) => `# カート

## 仕様

- 本を入れられる

## 設計

- Cookie で持つ

## コード

- 処理: src/a.ts

## データ

${data.map((name) => `- ${name}`).join("\n")}
`;

function repoWith(data: string[], files: Record<string, string> = {}) {
  const repo = TestRepo.create();
  made.push(repo);
  repo.write("docs/screens/cart.md", screen(data));
  repo.write("src/a.ts", "1");
  repo.write("supabase/migrations/001_init.sql", MIGRATION);
  for (const [file, text] of Object.entries(files)) repo.write(file, text);
  repo.commit("initial");
  return repo;
}

const JA = { ...DEFAULT_CONFIG, language: "ja" as const };

describe("selectTables", () => {
  const schema = parseSchema([MIGRATION]);

  it("「データ」の順に、スキーマにあるものとないものに分ける。大文字小文字とスキーマ名は問わない", () => {
    const { found, missing } = selectTables(schema, ["Sessions", "public.users", "ghost", "users"]);
    expect(found.map((t) => t.name)).toEqual(["sessions", "users"]);
    expect(missing).toEqual(["ghost"]);
  });
});

describe("renderEr", () => {
  const schema = parseSchema([MIGRATION]);

  it("テーブルが無ければ空", () => {
    expect(renderEr([])).toBe("");
  });

  it("書いたテーブルだけを描き、その間の外部キーだけを線にする", () => {
    const only = renderEr(selectTables(schema, ["sessions", "books"]).found);
    expect(only).toContain("sessions");
    expect(only).toContain("books");
    expect(only).not.toContain(">users<");
    expect(only).not.toContain("er-line");

    const both = renderEr(selectTables(schema, ["sessions", "users"]).found);
    expect(both.match(/class="er-line"/g)).toHaveLength(1);
    expect(both).toContain(">PK<");
    expect(both).toContain(">FK<");
  });

  it("名前に仕込まれたタグは無害になる", () => {
    const evil = parseSchema([`create table "<script>alert(1)</script>" (id int);`]);
    const svg = renderEr(evil.tables);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});

describe("スキーマの読み込みと検査", () => {
  it("SQL を古い順（ファイル名順）に読み、画面の「データ」を照らす", async () => {
    const repo = repoWith(["users", "ghost"]);
    const { screens, schema } = await inspectProject(repo.dir, JA);
    expect(schema?.tables.map((t) => t.name)).toEqual(["users", "sessions", "books"]);
    expect(screens[0]?.problems).toEqual([
      { kind: "table-not-in-schema", line: 18, detail: "ghost" },
    ]);
  });

  it("後のマイグレーションが前のを書き換える", async () => {
    const repo = repoWith(["users", "audit"], {
      "supabase/migrations/002_more.sql": "create table audit (id int); drop table users;",
    });
    const { screens } = await inspectProject(repo.dir, JA);
    expect(screens[0]?.problems.map((p) => p.detail)).toEqual(["users"]);
  });

  it("SQL が一つも無ければ、スキーマが無いものとして検査しない", async () => {
    const repo = TestRepo.create();
    made.push(repo);
    repo.write("docs/screens/cart.md", screen(["anything"]));
    repo.write("src/a.ts", "1");
    repo.commit("initial");
    const { screens, schema } = await inspectProject(repo.dir, JA);
    expect(schema).toBeUndefined();
    expect(screens[0]?.problems).toEqual([]);
  });

  it("設定の schema で場所を変えられ、空配列ならスキーマを使わない", async () => {
    const repo = repoWith(["ghost"], { "db/schema.sql": "create table ghost (id int);" });
    const custom = { ...JA, schema: ["db/*.sql"] };
    expect((await inspectProject(repo.dir, custom)).screens[0]?.problems).toEqual([]);
    const off = { ...JA, schema: [] };
    expect((await inspectProject(repo.dir, off)).schema).toBeUndefined();
  });

  it("シンボリックリンクの SQL は読まない（repo の外を読ませない）", async () => {
    const outside = TestRepo.create();
    made.push(outside);
    outside.write("secret.sql", "create table leaked (id int);");
    const repo = TestRepo.create();
    made.push(repo);
    repo.write("docs/screens/cart.md", screen(["leaked"]));
    repo.write("src/a.ts", "1");
    mkdirSync(path.join(repo.dir, "db"));
    symlinkSync(path.join(outside.dir, "secret.sql"), path.join(repo.dir, "db", "x.sql"));
    writeFileSync(path.join(repo.dir, "db", "real.sql"), "create table real_one (id int);");
    repo.commit("initial");
    const { schema } = await inspectProject(repo.dir, JA);
    expect(schema?.tables.map((t) => t.name)).toEqual(["real_one"]);
  });

  it("config の schema は文字列の配列でなければ設定エラー", () => {
    expect(parseConfig('{"schema":"db/*.sql"}')).toEqual({
      ok: false,
      error: "schema must be an array of strings",
    });
  });
});

describe("画面ページの ER", () => {
  it("スキーマがあれば図を出し、無いテーブルには印を付ける", async () => {
    const repo = repoWith(["sessions", "users", "ghost"]);
    const inspection = await inspectProject(repo.dir, JA);
    const view = inspection.screens[0];
    if (view === undefined) throw new Error("no screen");
    const html = renderScreenPage(view, inspection, "ja");
    expect(html).toContain('<svg class="er"');
    expect(html).toContain("スキーマにない");
  });

  it("スキーマが無ければ、テーブル名の一覧だけで図は出さない", async () => {
    const repo = TestRepo.create();
    made.push(repo);
    repo.write("docs/screens/cart.md", screen(["carts"]));
    repo.write("src/a.ts", "1");
    repo.commit("initial");
    const inspection = await inspectProject(repo.dir, JA);
    const view = inspection.screens[0];
    if (view === undefined) throw new Error("no screen");
    const html = renderScreenPage(view, inspection, "ja");
    expect(html).toContain("carts");
    expect(html).not.toContain("<svg");
  });
});
