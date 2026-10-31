import { rmSync, symlinkSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { checkCommit, DEFAULT_HOOK_CONFIG } from "../src/hook.js";

// このファイルのフィクスチャは日本語の見出し
const JA = { ...DEFAULT_HOOK_CONFIG, language: "ja" as const };
import { renderCheck, renderStatus, sanitize, statusExitCode } from "../src/render.js";
import { checkAllScreens } from "../src/status.js";
import { TestRepo } from "./helpers/repo.js";

const made: TestRepo[] = [];
afterEach(() => {
  for (const repo of made.splice(0)) repo.remove();
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

function repoWithScreens() {
  const repo = TestRepo.create();
  made.push(repo);
  repo.write("docs/screens/login.md", screen());
  repo.write("docs/screens/new.md", screen("- 判定: src/b.ts"));
  repo.write("src/a.ts", "1");
  repo.write("src/b.ts", "1");
  repo.commit("initial");
  return repo;
}

describe("checkAllScreens", () => {
  it("画面ごとに、古さと形の問題を集める。並びは画面のパス順", async () => {
    const repo = repoWithScreens();
    repo.write("src/b.ts", "2");
    repo.commit("change b");
    const reports = await checkAllScreens(repo.dir, JA);
    expect(reports.map((r) => [r.screen, r.staleness.status])).toEqual([
      ["docs/screens/login.md", "aligned"],
      ["docs/screens/new.md", "stale"],
    ]);
  });

  it("まだ追跡していない新しい画面も拾う", async () => {
    const repo = repoWithScreens();
    repo.write("docs/screens/draft.md", screen());
    const reports = await checkAllScreens(repo.dir, JA);
    expect(reports.map((r) => r.screen)).toContain("docs/screens/draft.md");
  });

  it("履歴にあってディスクから消えた画面は読み飛ばす", async () => {
    const repo = repoWithScreens();
    rmSync(`${repo.dir}/docs/screens/new.md`);
    const reports = await checkAllScreens(repo.dir, JA);
    expect(reports.map((r) => r.screen)).toEqual(["docs/screens/login.md"]);
  });

  it("シンボリックリンクの画面は、指す先を読まない", async () => {
    const repo = repoWithScreens();
    symlinkSync("/etc/hosts", `${repo.dir}/docs/screens/link.md`);
    const reports = await checkAllScreens(repo.dir, JA);
    expect(reports.map((r) => r.screen)).not.toContain("docs/screens/link.md");
  });

  it("git の外では例外", async () => {
    await expect(checkAllScreens("/", JA)).rejects.toThrow("failed");
  });
});

describe("statusExitCode", () => {
  it("古い・ファイルがない・形のエラーは 1、作業中の差分は 0", async () => {
    const repo = repoWithScreens();
    expect(statusExitCode(await checkAllScreens(repo.dir, JA), false)).toBe(0);
    repo.write("src/a.ts", "edited");
    expect(statusExitCode(await checkAllScreens(repo.dir, JA), false)).toBe(0);
    repo.commit("change a");
    expect(statusExitCode(await checkAllScreens(repo.dir, JA), false)).toBe(1);
    repo.write("docs/screens/login.md", screen("- 判定: src/nothing.ts"));
    repo.write("docs/screens/new.md", screen("- 判定はここ"));
    expect(statusExitCode(await checkAllScreens(repo.dir, JA), false)).toBe(1);
  });
});

describe("statusExitCode と判定できない状態", () => {
  const undetermined = (status: "unknown" | "no-git") => [
    { screen: "docs/screens/login.md", problems: [], staleness: { status, files: [{ path: "src/a.ts", state: "unchecked" as const }] } },
  ];

  it.each(["unknown", "no-git"] as const)("%s は既定では失敗にせず、strict のときだけ失敗にする", (status) => {
    expect(statusExitCode(undetermined(status), false)).toBe(0);
    expect(statusExitCode(undetermined(status), true)).toBe(1);
  });

  it("判定できない画面の表示は、揃っているとは言わず、理由を言う", () => {
    expect(renderStatus(undetermined("unknown"), "ja")).not.toContain("揃っている");
    expect(renderStatus(undetermined("unknown"), "ja")).toContain("履歴が浅い");
    expect(renderStatus(undetermined("no-git"), "ja")).toContain("git の管理下にありません");
  });
});

describe("sanitize", () => {
  it("端末を操作する制御文字を落とす", () => {
    expect(sanitize("a\u001b[31mred\u001b[0m\u0007b\r\nc")).toBe("a?[31mred?[0m?b??c");
  });

  it("画面の中身に仕込まれた制御文字は、出力に出ない", async () => {
    const repo = repoWithScreens();
    repo.write("docs/screens/login.md", screen("- 判定\u001b]0;pwned\u0007はここ"));
    repo.git("add", "-A");
    const text = renderCheck(await checkCommit(repo.dir, JA), "ja");
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f]/);
    expect(text).toContain("コードの行にファイルパスがありません");
  });
});

describe("renderStatus", () => {
  it("揃っている画面と、そうでない画面の理由を出す", async () => {
    const repo = repoWithScreens();
    repo.write("src/b.ts", "2");
    repo.commit("change b");
    const text = renderStatus(await checkAllScreens(repo.dir, JA), "ja");
    expect(text).toBe(
      ["docs/screens/login.md: 揃っている", "docs/screens/new.md:", "  実装の方が新しい: src/b.ts"].join("\n"),
    );
  });
});

describe("英語の出力", () => {
  it("renderStatus と renderCheck は、言語を渡すと英語で出す", async () => {
    const repo = repoWithScreens();
    repo.write("src/b.ts", "2");
    repo.commit("change b");
    const status = renderStatus(await checkAllScreens(repo.dir, { ...JA, language: "ja" }), "en");
    expect(status).toBe(["docs/screens/login.md: up to date", "docs/screens/new.md:", "  code is newer than the spec: src/b.ts"].join("\n"));
    repo.write("src/a.ts", "2");
    repo.git("add", "-A");
    const check = renderCheck(await checkCommit(repo.dir, JA), "en");
    expect(check).toContain("src/a.ts changed, but no screen that lists it under Code was updated.");
    expect(check).toContain("docs/screens/login.md");
  });
});
