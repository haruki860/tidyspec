import { request } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { inspectAllScreens } from "../src/checks/status.js";
import { run } from "../src/cli/cli.js";
import { parsePort } from "../src/cli/previewCommand.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { escapeHtml, renderIndex, renderScreenPage } from "../src/preview/html.js";
import { type PreviewServer, startPreview } from "../src/preview/server.js";
import { TestRepo } from "./helpers/repo.js";

const JA = { ...DEFAULT_CONFIG, language: "ja" as const };
const made: TestRepo[] = [];
const servers: PreviewServer[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
  for (const repo of made.splice(0)) repo.remove();
});

const SCREEN = `# ログイン

## 仕様

- メールで入れる

## 設計

- 連続失敗でロックする

## コード

- 判定: src/a.ts

## データ

- users
`;

function repoWith(screen = SCREEN) {
  const repo = TestRepo.create();
  made.push(repo);
  repo.write("docs/screens/login.md", screen);
  repo.write("src/a.ts", "1");
  repo.commit("initial");
  return repo;
}

async function firstView(repo: TestRepo) {
  const [view] = await inspectAllScreens(repo.dir, JA);
  if (view === undefined) throw new Error("no screen found in the test repo");
  return view;
}

async function start(repo: TestRepo, errors: unknown[] = []) {
  const started = await startPreview({
    root: repo.dir,
    config: JA,
    port: 0,
    onError: (error) => errors.push(error),
  });
  if (!started.ok) throw new Error(started.error);
  servers.push(started.server);
  return started.server;
}

describe("escapeHtml", () => {
  it("HTML として働く記号を無害にする", () => {
    expect(escapeHtml(`<script>alert("x")</script>&'`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&amp;&#39;",
    );
  });
});

describe("画面の表示", () => {
  it("一覧に題名・状態・パスが出て、画面へのリンクになる", async () => {
    const repo = repoWith();
    const html = renderIndex(await inspectAllScreens(repo.dir, JA), "ja");
    expect(html).toContain("ログイン");
    expect(html).toContain("揃っている");
    expect(html).toContain("/screen?file=docs%2Fscreens%2Flogin.md");
  });

  it("画面に四つの見出しと中身、コードのパスが出る", async () => {
    const repo = repoWith();
    const html = renderScreenPage(
      await firstView(repo),
      await inspectAllScreens(repo.dir, JA),
      "ja",
    );
    for (const text of [
      "仕様",
      "設計",
      "コード",
      "データ",
      "メールで入れる",
      "src/a.ts",
      "users",
    ]) {
      expect(html).toContain(text);
    }
  });

  it("実装の方が新しいと、そのファイルに印が付く", async () => {
    const repo = repoWith();
    repo.write("src/a.ts", "2");
    repo.commit("change code only");
    const html = renderScreenPage(
      await firstView(repo),
      await inspectAllScreens(repo.dir, JA),
      "ja",
    );
    expect(html).toContain("実装の方が新しい");
  });

  it("画面の中身に仕込まれたタグは、そのまま出ず無害になる", async () => {
    const repo = repoWith(SCREEN.replace("メールで入れる", "<img src=x onerror=alert(1)>"));
    const html = renderIndex(await inspectAllScreens(repo.dir, JA), "ja");
    const page = renderScreenPage(
      await firstView(repo),
      await inspectAllScreens(repo.dir, JA),
      "ja",
    );
    expect(page).not.toContain("<img");
    expect(page).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
  });
});

describe("プレビューのサーバー", () => {
  it("127.0.0.1 で一覧と画面を返し、安全なヘッダーを付ける", async () => {
    const server = await start(repoWith());
    const index = await fetch(server.url);
    expect(index.status).toBe(200);
    expect(index.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(index.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await index.text()).toContain("ログイン");
    const page = await fetch(
      `${server.url}screen?file=${encodeURIComponent("docs/screens/login.md")}`,
    );
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("連続失敗でロックする");
  });

  it("内容は毎回読み直す", async () => {
    const repo = repoWith();
    const server = await start(repo);
    repo.write("docs/screens/login.md", SCREEN.replace("連続失敗でロックする", "三回でロックする"));
    const page = await fetch(
      `${server.url}screen?file=${encodeURIComponent("docs/screens/login.md")}`,
    );
    expect(await page.text()).toContain("三回でロックする");
  });

  it.each([
    ["画面でないファイル", "src/a.ts"],
    ["repo の外", "../../etc/passwd"],
    ["絶対パス", "/etc/passwd"],
    ["指定なし", ""],
  ])("画面の一覧に無いものは 404: %s", async (_name, file) => {
    const server = await start(repoWith());
    const response = await fetch(`${server.url}screen?file=${encodeURIComponent(file)}`);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("root:");
  });

  it("GET 以外は 405", async () => {
    const server = await start(repoWith());
    expect((await fetch(server.url, { method: "POST" })).status).toBe(405);
  });

  it("Host が自分のアドレスでなければ 403（DNS rebinding 対策）", async () => {
    const server = await start(repoWith());
    const { port } = new URL(server.url);
    const text = await new Promise<string>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: "/", headers: { Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(String(res.statusCode));
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(text).toBe("403");
  });

  it("想定外の失敗は、詳細を返さず 500 にして、onError に渡す", async () => {
    const repo = repoWith();
    const errors: unknown[] = [];
    const server = await start(repo, errors);
    repo.remove();
    const response = await fetch(server.url);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(errors).toHaveLength(1);
  });

  it("ポートが使われていれば、失敗を値で返す", async () => {
    const first = await start(repoWith());
    const second = await startPreview({
      root: made[0]?.dir ?? "",
      config: JA,
      port: Number(new URL(first.url).port),
      onError: () => {},
    });
    expect(second.ok).toBe(false);
  });
});

describe("tidyspec preview", () => {
  it("URL を出し、止める合図で終わって 0", async () => {
    const repo = repoWith();
    const out: string[] = [];
    let stop: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      stop = resolve;
    });
    const running = run(
      ["preview", "--port", "0"],
      { out: (t) => out.push(t), err: () => {}, waitForInterrupt: () => waiting },
      repo.dir,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(out.join("\n"))?.[0];
    expect(url).toBeDefined();
    expect((await fetch(url ?? "")).status).toBe(200);
    stop();
    expect(await running).toBe(0);
  });

  it("止める合図を渡されなければ 2", async () => {
    const repo = repoWith();
    const err: string[] = [];
    const code = await run(["preview"], { out: () => {}, err: (t) => err.push(t) }, repo.dir);
    expect(code).toBe(2);
    expect(err.join("")).toContain("preview");
  });

  it.each(["abc", "-1", "70000", "1.5", ""])("--port %j は 2", async (value) => {
    const repo = repoWith();
    const err: string[] = [];
    const code = await run(
      ["preview", "--port", value],
      { out: () => {}, err: (t) => err.push(t), waitForInterrupt: () => new Promise(() => {}) },
      repo.dir,
    );
    expect(code).toBe(2);
    expect(err.join("")).toContain("--port");
  });
});

describe("parsePort", () => {
  it("既定と 0 と範囲", () => {
    expect(parsePort(undefined)).toEqual({ ok: true, port: 4321 });
    expect(parsePort("0")).toEqual({ ok: true, port: 0 });
    expect(parsePort("65535")).toEqual({ ok: true, port: 65535 });
    expect(parsePort("65536").ok).toBe(false);
  });
});
