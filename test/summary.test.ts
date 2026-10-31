import { afterEach, describe, expect, it } from "vitest";
import { renderSummary } from "../src/checks/renderSummary.js";
import { summarize } from "../src/checks/summary.js";
import { run } from "../src/cli/cli.js";
import { type Config, DEFAULT_CONFIG } from "../src/config.js";
import { TestRepo } from "./helpers/repo.js";

const JA: Config = { ...DEFAULT_CONFIG, language: "ja" };

const made: TestRepo[] = [];
afterEach(() => {
  for (const repo of made.splice(0)) repo.remove();
});

const LOGIN = "docs/screens/login.md";
const ORDER = "docs/screens/order.md";

const screen = (title: string, spec: string, code = "- 処理: src/a.ts") => `# ${title}

## 仕様

- ${spec}

## 設計

- 理由

## コード

${code}

## データ

- users
`;

/** main に画面2枚と実装があり、そこから feature ブランチに移ったリポジトリ。 */
function branched(): TestRepo {
  const repo = TestRepo.create();
  made.push(repo);
  repo.write(LOGIN, screen("ログイン", "メールで入れる"));
  repo.write(ORDER, screen("注文", "注文できる", "- 処理: src/b.ts"));
  repo.write("src/a.ts", "1");
  repo.write("src/b.ts", "1");
  repo.commit("initial");
  repo.git("switch", "-q", "-c", "feature");
  return repo;
}

async function summaryOf(repo: TestRepo, base: string | undefined = "main") {
  const result = await summarize(repo.dir, JA, base);
  if (!result.ok) throw new Error(result.error);
  return result.summary;
}

describe("summarize", () => {
  it("変えた画面を、タイトルと追加・削除の行つきで返す", async () => {
    const repo = branched();
    repo.write(LOGIN, screen("ログイン", "メールとパスワードで入れる"));
    repo.commit("spec");
    const { changed } = await summaryOf(repo);
    expect(changed).toEqual([
      {
        screen: LOGIN,
        title: "ログイン",
        change: "modified",
        lines: [
          { kind: "remove", text: "- メールで入れる" },
          { kind: "add", text: "- メールとパスワードで入れる" },
        ],
        truncated: false,
      },
    ]);
  });

  it("追加された画面と、消された画面（タイトルは元の内容から）", async () => {
    const repo = branched();
    repo.write("docs/screens/cart.md", screen("カート", "入れられる", "- 処理: src/a.ts"));
    repo.git("rm", "-q", ORDER);
    repo.commit("add and remove");
    const { changed } = await summaryOf(repo);
    expect(changed.map((c) => [c.screen, c.title, c.change])).toEqual([
      ["docs/screens/cart.md", "カート", "added"],
      [ORDER, "注文", "removed"],
    ]);
  });

  it("実装だけ変えて画面を変えていないものを、変わった実装とともに返す", async () => {
    const repo = branched();
    repo.write("src/a.ts", "2");
    repo.commit("code only");
    const { changed, behind } = await summaryOf(repo);
    expect(changed).toEqual([]);
    expect(behind).toEqual([{ screen: LOGIN, title: "ログイン", files: ["src/a.ts"] }]);
  });

  it("画面も変えていれば、遅れとは数えない", async () => {
    const repo = branched();
    repo.write("src/a.ts", "2");
    repo.write(LOGIN, screen("ログイン", "変えた"));
    repo.commit("both");
    expect((await summaryOf(repo)).behind).toEqual([]);
  });

  it("分かれたあとに base 側で起きた変更は含めない", async () => {
    const repo = branched();
    repo.write("src/b.ts", "mine");
    repo.commit("on feature");
    repo.git("switch", "-q", "main");
    repo.write(LOGIN, screen("ログイン", "main だけの変更"));
    repo.commit("on main");
    repo.git("switch", "-q", "feature");
    const { changed, behind } = await summaryOf(repo);
    expect(changed).toEqual([]);
    expect(behind.map((b) => b.screen)).toEqual([ORDER]);
  });

  it("長い差分は、上限で切って知らせる", async () => {
    const repo = branched();
    const spec = Array.from({ length: 60 }, (_, i) => `行${i}`).join("\n- ");
    repo.write(LOGIN, screen("ログイン", spec));
    repo.commit("long");
    const [item] = (await summaryOf(repo)).changed;
    expect(item?.lines).toHaveLength(40);
    expect(item?.truncated).toBe(true);
  });

  it("base を省略すると main を使う", async () => {
    const repo = branched();
    repo.write(LOGIN, screen("ログイン", "変えた"));
    repo.commit("spec");
    expect((await summaryOf(repo, undefined)).changed).toHaveLength(1);
  });

  it("base が見つからない、または `-` で始まるなら、エラーにする", async () => {
    const repo = branched();
    expect(await summarize(repo.dir, JA, "no-such")).toEqual({
      ok: false,
      error: 'no base branch found "no-such"; pass one with --base <ref>',
    });
    expect((await summarize(repo.dir, JA, "--output=x")).ok).toBe(false);
  });
});

describe("renderSummary", () => {
  const item = (lines: { kind: "add" | "remove"; text: string }[]) => ({
    base: "abc",
    changed: [
      {
        screen: LOGIN,
        title: "ログイン",
        change: "modified" as const,
        lines,
        truncated: false,
      },
    ],
    behind: [],
  });

  it("見出し、差分の囲み、実装の遅れを Markdown で出す", () => {
    const text = renderSummary(
      {
        ...item([{ kind: "add", text: "- 新しい" }]),
        behind: [{ screen: ORDER, title: null, files: ["src/b.ts"] }],
      },
      "en",
    );
    expect(text).toBe(
      [
        "## Spec changes",
        "",
        "### ログイン (`docs/screens/login.md`) — modified",
        "",
        "```diff",
        "+- 新しい",
        "```",
        "",
        "## Code changed, spec not updated",
        "",
        "- `docs/screens/order.md`: `src/b.ts`",
        "",
      ].join("\n"),
    );
  });

  it("本文にバッククォートの柵があっても、囲みを閉じさせない", () => {
    const text = renderSummary(item([{ kind: "add", text: "```" }]), "ja");
    expect(text).toContain("````diff\n+```\n````");
  });

  it("制御文字は出力に混ぜない", () => {
    const text = renderSummary(item([{ kind: "add", text: "a\u001b[31mb" }]), "ja");
    expect(text).not.toContain("\u001b");
  });

  it("変更が無ければ、その旨だけを出す", () => {
    expect(renderSummary({ base: "abc", changed: [], behind: [] }, "ja")).toBe(
      "## 仕様の変更\n\n変わった画面はありません。\n",
    );
  });
});

describe("summary コマンド", () => {
  it("Markdown を標準出力に出し、0 で終わる", async () => {
    const repo = branched();
    repo.write("tidyspec.json", '{"language":"ja"}');
    repo.write(LOGIN, screen("ログイン", "変えた"));
    repo.commit("spec");
    const out: string[] = [];
    const code = await run(
      ["summary", "--base", "main"],
      { out: (t) => out.push(t), err: () => {} },
      repo.dir,
    );
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("### ログイン");
  });

  it("base が無ければ 2 で終わる", async () => {
    const repo = branched();
    const err: string[] = [];
    const code = await run(
      ["summary", "--base", "nope"],
      { out: () => {}, err: (t) => err.push(t) },
      repo.dir,
    );
    expect(code).toBe(2);
    expect(err.join("")).toContain("--base");
  });
});
