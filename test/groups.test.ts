import { afterEach, describe, expect, it } from "vitest";
import type { ScreenInspection } from "../src/checks/status.js";
import { inspectProject } from "../src/checks/status.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { groupScreens } from "../src/preview/groups.js";
import { renderIndex } from "../src/preview/html.js";
import { TestRepo } from "./helpers/repo.js";

function view(screen: string): ScreenInspection {
  return {
    screen,
    parsed: { title: null, spec: [], design: [], code: [], data: [] },
    problems: [],
    staleness: { status: "aligned", files: [] },
  };
}

const summarize = (screens: string[]) =>
  groupScreens(screens.map(view)).map((g) => [g.name, g.views.map((v) => v.screen)]);

describe("groupScreens", () => {
  it("全部が同じディレクトリなら、一つのグループ（名前は空）", () => {
    expect(summarize(["docs/screens/a.md", "docs/screens/b.md"])).toEqual([
      ["", ["docs/screens/a.md", "docs/screens/b.md"]],
    ]);
  });

  it("共通の上のディレクトリを除いて、サブディレクトリごとにまとめる。直下が先", () => {
    expect(
      summarize([
        "docs/screens/auth/login.md",
        "docs/screens/home.md",
        "docs/screens/shop/cart.md",
        "docs/screens/auth/signup.md",
      ]),
    ).toEqual([
      ["", ["docs/screens/home.md"]],
      ["auth", ["docs/screens/auth/login.md", "docs/screens/auth/signup.md"]],
      ["shop", ["docs/screens/shop/cart.md"]],
    ]);
  });

  it("全ての画面が同じサブディレクトリにあれば、その名前は共通の部分として落とす", () => {
    expect(summarize(["docs/screens/auth/a.md", "docs/screens/auth/b.md"])).toEqual([
      ["", ["docs/screens/auth/a.md", "docs/screens/auth/b.md"]],
    ]);
  });

  it("画面が無ければ空", () => {
    expect(groupScreens([])).toEqual([]);
  });

  it("入れ子のディレクトリは、残りの道をそのまま名前にする", () => {
    expect(summarize(["s/a/b/x.md", "s/c/y.md"]).map(([name]) => name)).toEqual(["a/b", "c"]);
  });
});

const made: TestRepo[] = [];
afterEach(() => {
  for (const repo of made.splice(0)) repo.remove();
});

const screen = (title: string, firstSpec: string) => `# ${title}

## 仕様

- ${firstSpec}
- 二つ目

## 設計

- 理由

## コード

- 処理: src/a.ts

## データ

- users
`;

describe("機能一覧（一覧ページ）", () => {
  it("ディレクトリごとの見出しと、仕様の最初の一行が出る", async () => {
    const repo = TestRepo.create();
    made.push(repo);
    repo.write("docs/screens/auth/login.md", screen("ログイン", "メールで入れる"));
    repo.write("docs/screens/shop/cart.md", screen("カート", "本を入れられる"));
    repo.write("src/a.ts", "1");
    repo.commit("initial");
    const html = renderIndex(
      await inspectProject(repo.dir, { ...DEFAULT_CONFIG, language: "ja" }),
      "ja",
    );
    expect(html).toContain("<h2>auth</h2>");
    expect(html).toContain("<h2>shop</h2>");
    expect(html).toContain("メールで入れる");
    expect(html).not.toContain("二つ目");
  });

  it("グループが一つなら、見出しは出さない", async () => {
    const repo = TestRepo.create();
    made.push(repo);
    repo.write("docs/screens/login.md", screen("ログイン", "メールで入れる"));
    repo.write("src/a.ts", "1");
    repo.commit("initial");
    const html = renderIndex(await inspectProject(repo.dir, DEFAULT_CONFIG), "en");
    expect(html).not.toContain("<h2>");
  });
});
