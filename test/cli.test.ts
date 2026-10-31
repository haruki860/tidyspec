import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/cli/cli.js";
import { TestRepo } from "./helpers/repo.js";

const made: TestRepo[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const repo of made.splice(0)) repo.remove();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const screen = (code = "- 判定: src/a.ts") => `# ログイン

## 仕様

- メールで入れる

## 設計

- 連続失敗でロックする

## コード

${code}

## データ

- users
`;

function repoWithScreen() {
  const repo = TestRepo.create();
  made.push(repo);
  repo.write("docs/screens/login.md", screen());
  repo.write("src/a.ts", "1");
  repo.write("tidyspec.json", '{"language":"ja"}');
  repo.commit("initial");
  return repo;
}

async function exec(args: string[], cwd: string) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, { out: (t) => out.push(t), err: (t) => err.push(t) }, cwd);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("tidyspec check", () => {
  it("問題が無ければ 0 で、標準出力に出す", async () => {
    const repo = repoWithScreen();
    const result = await exec(["check"], repo.dir);
    expect(result).toEqual({ code: 0, out: "仕様の検査: 問題なし", err: "" });
  });

  it("止める問題があれば 1 で、標準エラーに出す", async () => {
    const repo = repoWithScreen();
    repo.write("src/a.ts", "2");
    repo.git("add", "-A");
    const result = await exec(["check"], repo.dir);
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("src/a.ts を変えましたが");
    expect(result.err).toContain("docs/screens/login.md");
  });

  it("サブディレクトリから実行しても、repo のルートを基準にする", async () => {
    const repo = repoWithScreen();
    repo.write("src/a.ts", "2");
    repo.git("add", "-A");
    expect((await exec(["check"], path.join(repo.dir, "src"))).code).toBe(1);
  });

  it("--json は機械で読める形で出す", async () => {
    const repo = repoWithScreen();
    repo.write("src/a.ts", "2");
    repo.git("add", "-A");
    const result = await exec(["check", "--json"], repo.dir);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.err)).toMatchObject({
      ok: false,
      violations: [{ kind: "spec-not-updated", file: "src/a.ts" }],
    });
  });

  it("tidyspec.json の設定を使う", async () => {
    const repo = repoWithScreen();
    repo.write("specs/other.md", screen("- 判定: src/b.ts"));
    repo.write("src/b.ts", "1");
    repo.write("tidyspec.json", '{"language":"ja","screens":["specs/*.md"],"implementation":[]}');
    repo.commit("config");
    repo.write("src/a.ts", "2");
    repo.git("add", "-A");
    // 設定が無ければ docs/screens/login.md が src/a.ts を載せていて止まる。設定で対象外にしたので通る
    expect((await exec(["check"], repo.dir)).code).toBe(0);
  });
});

describe("tidyspec status", () => {
  it("揃っていれば 0", async () => {
    const result = await exec(["status"], repoWithScreen().dir);
    expect(result).toEqual({ code: 0, out: "docs/screens/login.md: 揃っている", err: "" });
  });

  it("実装の方が新しければ 1", async () => {
    const repo = repoWithScreen();
    repo.write("src/a.ts", "2");
    repo.commit("change impl");
    const result = await exec(["status"], repo.dir);
    expect(result.code).toBe(1);
    expect(result.out).toContain("実装の方が新しい: src/a.ts");
  });

  it("--json は画面ごとの配列", async () => {
    const result = await exec(["status", "--json"], repoWithScreen().dir);
    expect(JSON.parse(result.out)).toMatchObject([
      { screen: "docs/screens/login.md", staleness: { status: "aligned" } },
    ]);
  });
});

describe("使い方の誤りは 2", () => {
  it.each([
    ["コマンドなし", []],
    ["知らないコマンド", ["preview"]],
    ["余計な引数", ["check", "extra"]],
    ["知らないオプション", ["check", "--nope"]],
  ])("%s", async (_name, args) => {
    const result = await exec(args, repoWithScreen().dir);
    expect(result.code).toBe(2);
    expect(result.err).toContain("Usage");
  });

  it("--help は 0 で、使い方を標準出力に出す", async () => {
    const result = await exec(["--help"], repoWithScreen().dir);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Usage");
  });

  it("git の外では 2", async () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tidyspec-nogit-")));
    dirs.push(dir);
    const result = await exec(["check"], dir);
    expect(result.code).toBe(2);
    expect(result.err).toContain("inside a git repository");
  });

  it("検査の途中で git が失敗したら、問題なしにせず 2", async () => {
    const repo = repoWithScreen();
    writeFileSync(path.join(repo.dir, "tidyspec.json"), '{"screens":["../outside/*.md"]}');
    for (const command of ["check", "status"]) {
      const result = await exec([command], repo.dir);
      expect(result.code).toBe(2);
      expect(result.err).toContain("git ls-files failed");
    }
  });

  it("壊れた設定は 2。既定値に戻して通さない", async () => {
    const repo = repoWithScreen();
    writeFileSync(path.join(repo.dir, "tidyspec.json"), '{"screen":["x"]}');
    const result = await exec(["check"], repo.dir);
    expect(result.code).toBe(2);
    expect(result.err).toContain("unknown keys");
  });
});

describe("言語の設定", () => {
  it("設定が無ければ英語の見出しと英語の出力で動く", async () => {
    const repo = TestRepo.create();
    made.push(repo);
    repo.write(
      "docs/screens/login.md",
      readFileSync(new URL("../examples/shop-en/login.md", import.meta.url), "utf8"),
    );
    repo.write("src/auth/lock.ts", "1");
    repo.write("src/auth/login.ts", "1");
    repo.write("src/pages/login.tsx", "1");
    repo.commit("initial");
    expect(await exec(["status"], repo.dir)).toEqual({
      code: 0,
      out: "docs/screens/login.md: up to date",
      err: "",
    });
    repo.write("src/auth/lock.ts", "2");
    repo.git("add", "-A");
    const result = await exec(["check"], repo.dir);
    expect(result.code).toBe(1);
    expect(result.err).toContain("src/auth/lock.ts changed, but no screen");
  });
});
