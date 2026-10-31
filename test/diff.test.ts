import { afterEach, describe, expect, it } from "vitest";
import { inspectProject } from "../src/checks/status.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { MAX_DIFF_LINES, parseLastChange } from "../src/core/diff.js";
import { renderScreenPage } from "../src/preview/html.js";
import { lastChange } from "../src/repo/history.js";
import { TestRepo } from "./helpers/repo.js";

const header = "abc1234\x002026-10-31\x00メールで入れる\x00\n";
const diff = (body: string) =>
  `diff --git a/s.md b/s.md\nindex 1..2 100644\n--- a/s.md\n+++ b/s.md\n${body}`;

describe("parseLastChange", () => {
  it("追加と削除の行だけを取り、ヘッダと @@ は捨てる", () => {
    const change = parseLastChange(header + diff("@@ -2 +2 @@\n-古い\n+新しい\n"));
    expect(change).toEqual({
      commit: "abc1234",
      date: "2026-10-31",
      subject: "メールで入れる",
      lines: [
        { kind: "remove", text: "古い" },
        { kind: "add", text: "新しい" },
      ],
      truncated: false,
    });
  });

  it("本文が `---` や `+++` で始まる行も、行として読む", () => {
    const change = parseLastChange(header + diff("@@ -1 +1 @@\n----\n++++\n"));
    expect(change?.lines).toEqual([
      { kind: "remove", text: "---" },
      { kind: "add", text: "+++" },
    ]);
  });

  it("上限を超えたら切って、切ったと知らせる", () => {
    const many = Array.from({ length: MAX_DIFF_LINES + 5 }, (_, i) => `+行${i}\n`).join("");
    const change = parseLastChange(header + diff(`@@ -0,0 +1 @@\n${many}`));
    expect(change?.lines).toHaveLength(MAX_DIFF_LINES);
    expect(change?.truncated).toBe(true);
  });

  it("変更行が無い、または形が違う出力は undefined", () => {
    expect(parseLastChange("")).toBeUndefined();
    expect(parseLastChange(header)).toBeUndefined();
    expect(parseLastChange(header + diff(""))).toBeUndefined();
  });
});

const made: TestRepo[] = [];
afterEach(() => {
  for (const repo of made.splice(0)) repo.remove();
});

const SCREEN = "docs/screens/login.md";
const body = (spec: string) => `# ログイン

## 仕様

- ${spec}

## 設計

- 理由

## コード

- 処理: src/a.ts

## データ

- users
`;

function repoWithTwoCommits(): TestRepo {
  const repo = TestRepo.create();
  made.push(repo);
  repo.write(SCREEN, body("メールで入れる"));
  repo.write("src/a.ts", "1");
  repo.commit("first");
  repo.write(SCREEN, body("メールとパスワードで入れる"));
  repo.commit("change spec <b>");
  return repo;
}

describe("lastChange", () => {
  it("画面を最後に変えたコミットの差分を返す（その前のコミットではなく）", async () => {
    const change = await lastChange(repoWithTwoCommits().dir, SCREEN);
    expect(change?.subject).toBe("change spec <b>");
    expect(change?.lines).toEqual([
      { kind: "remove", text: "- メールで入れる" },
      { kind: "add", text: "- メールとパスワードで入れる" },
    ]);
  });

  it("最初のコミットだけでも、全行が追加として返る", async () => {
    const repo = TestRepo.create();
    made.push(repo);
    repo.write(SCREEN, body("メールで入れる"));
    repo.commit("first");
    const change = await lastChange(repo.dir, SCREEN);
    expect(change?.lines.every((line) => line.kind === "add")).toBe(true);
  });

  it("未コミットの画面は undefined", async () => {
    const repo = TestRepo.create();
    made.push(repo);
    repo.write("x.txt", "1");
    repo.commit("first");
    repo.write(SCREEN, body("メールで入れる"));
    expect(await lastChange(repo.dir, SCREEN)).toBeUndefined();
  });
});

describe("画面ページの直近の変更", () => {
  it("差分を出し、コミットの題名は HTML としてエスケープする", async () => {
    const repo = repoWithTwoCommits();
    const config = { ...DEFAULT_CONFIG, language: "ja" } as const;
    const inspection = await inspectProject(repo.dir, config);
    const view = inspection.screens[0];
    if (view === undefined) throw new Error("画面が見つからない");
    const change = await lastChange(repo.dir, SCREEN);
    const html = renderScreenPage(view, inspection, { language: "ja", change });
    expect(html).toContain("この仕様の直近の変更");
    expect(html).toContain("メールとパスワードで入れる");
    expect(html).toContain("change spec &lt;b&gt;");
    expect(html).not.toContain("change spec <b>");
  });

  it("変更が無ければ、その見出しを出さない", async () => {
    const repo = repoWithTwoCommits();
    const inspection = await inspectProject(repo.dir, DEFAULT_CONFIG);
    const view = inspection.screens[0];
    if (view === undefined) throw new Error("画面が見つからない");
    const html = renderScreenPage(view, inspection, { language: "en", change: undefined });
    expect(html).not.toContain("Last change to this spec");
  });
});
