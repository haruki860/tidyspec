import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { run } from "../src/cli/cli.js";
import type { Io } from "../src/cli/io.js";
import type { Prompter } from "../src/cli/prompter.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { HOOK_SCRIPT } from "../src/setup/hookfile.js";
import {
  applyInit,
  type InitAnswers,
  screensDirFromConfig,
  validateScreensDir,
} from "../src/setup/init.js";
import {
  BLOCK_END,
  BLOCK_START,
  instructionBlock,
  upsertBlock,
} from "../src/setup/instructions.js";
import { TestRepo } from "./helpers/repo.js";

const made: TestRepo[] = [];
afterEach(() => {
  for (const repo of made.splice(0)) repo.remove();
});

function newRepo() {
  const repo = TestRepo.create();
  made.push(repo);
  repo.write("README.md", "# x\n");
  repo.commit("initial");
  return repo;
}

const ANSWERS: InitAnswers = {
  language: "en",
  screensDir: "docs/screens",
  installHook: true,
  writeInstructions: true,
};

const read = (repo: TestRepo, file: string) => readFileSync(path.join(repo.dir, file), "utf8");
const has = (repo: TestRepo, file: string) => existsSync(path.join(repo.dir, file));

async function exec(args: string[], cwd: string, prompt?: Prompter) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    ...(prompt ? { prompt } : {}),
  };
  const code = await run(args, io, cwd);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

/** 台本どおりに答える質問役。聞かれた順に、答えを前から使う。 */
function scripted(answers: (string | boolean)[]): Prompter & { asked: string[] } {
  const asked: string[] = [];
  const next = (question: string) => {
    asked.push(question);
    const answer = answers.shift();
    if (answer === undefined) throw new Error(`no scripted answer for: ${question}`);
    return answer;
  };
  return {
    asked,
    async select(question, choices, fallback) {
      const answer = next(question);
      return choices.find((choice) => choice.value === answer)?.value ?? fallback;
    },
    async confirm(question) {
      return next(question) === true;
    },
    async text(question, fallback) {
      const answer = next(question);
      return typeof answer === "string" && answer !== "" ? answer : fallback;
    },
  };
}

describe("instructionBlock / upsertBlock", () => {
  it("言語の見出しと置き場と文字数が入る", () => {
    const en = instructionBlock("en", "docs/screens", 60);
    expect(en).toContain("Spec, Design, Code, Data");
    expect(en).toContain("`docs/screens/`");
    expect(en).toContain("at most 60 characters");
    expect(en).toContain("do not use `--no-verify`");
    const ja = instructionBlock("ja", "specs", 80);
    expect(ja).toContain("「仕様」「設計」「コード」「データ」");
    expect(ja).toContain("`--no-verify` を使わない");
  });

  it("ファイルが無い・空なら、指示文だけのファイルになる", () => {
    const block = instructionBlock("en", "docs/screens");
    expect(upsertBlock(undefined, block)).toEqual({ ok: true, text: `${block}\n` });
    expect(upsertBlock("  \n", block)).toEqual({ ok: true, text: `${block}\n` });
  });

  it("目印が無ければ、既存の文章を残して末尾に足す", () => {
    const result = upsertBlock("# Agents\n\nBe nice.\n", instructionBlock("en", "docs/screens"));
    expect(
      result.ok && result.text.startsWith("# Agents\n\nBe nice.\n\n<!-- tidyspec:start -->"),
    ).toBe(true);
  });

  it("目印があれば、間だけを置き換え、前後は触らない。再実行しても同じ", () => {
    const first = upsertBlock("before\n", instructionBlock("en", "docs/screens"));
    if (!first.ok) throw new Error("unexpected");
    const withAfter = `${first.text}after\n`;
    const second = upsertBlock(withAfter, instructionBlock("ja", "specs"));
    if (!second.ok) throw new Error("unexpected");
    expect(second.text.startsWith("before\n\n")).toBe(true);
    expect(second.text.endsWith(`${BLOCK_END}\nafter\n`)).toBe(true);
    expect(second.text).toContain("画面の仕様");
    expect(second.text).not.toContain("Screen specs");
    const third = upsertBlock(second.text, instructionBlock("ja", "specs"));
    expect(third).toEqual({ ok: true, text: second.text });
  });

  it.each([
    ["開始だけ", `a\n${BLOCK_START}\nb\n`],
    ["終了だけ", `a\n${BLOCK_END}\n`],
    ["逆順", `${BLOCK_END}\n${BLOCK_START}\n`],
    ["二重", `${BLOCK_START}\n${BLOCK_END}\n${BLOCK_START}\n${BLOCK_END}\n`],
  ])("目印が壊れている（%s）ときは、何も変えずにエラー", (_name, text) => {
    expect(upsertBlock(text, instructionBlock("en", "docs/screens"))).toMatchObject({ ok: false });
  });
});

describe("validateScreensDir / screensDirFromConfig", () => {
  it.each([
    ["docs/screens", "docs/screens"],
    ["docs/screens/", "docs/screens"],
    [" specs ", "specs"],
    ["./docs//screens", "docs/screens"],
  ])("%s を受け付ける", (input, dir) => {
    expect(validateScreensDir(input)).toEqual({ ok: true, dir });
  });

  it.each([
    "",
    "  ",
    "/etc",
    "../x",
    "a/../../x",
    ".",
    "a\\b",
    "docs/*",
    "a:b",
    "x[1]",
    "{a,b}",
    "!x",
  ])("%j を断る", (input) => {
    expect(validateScreensDir(input)).toMatchObject({ ok: false });
  });

  it("設定が「ディレクトリの全ての .md」の形ならディレクトリを取り出す", () => {
    expect(screensDirFromConfig({ ...DEFAULT_CONFIG, screens: ["specs/**/*.md"] })).toBe("specs");
    expect(screensDirFromConfig({ ...DEFAULT_CONFIG, screens: ["specs/*.md"] })).toBeUndefined();
    expect(
      screensDirFromConfig({ ...DEFAULT_CONFIG, screens: ["a/**/*.md", "b/**/*.md"] }),
    ).toBeUndefined();
  });
});

describe("applyInit", () => {
  it("新しいリポジトリに、設定・指示文・フックを作る。フックは実行できる", async () => {
    const repo = newRepo();
    const result = await applyInit(repo.dir, ANSWERS, { dryRun: false });
    expect(result).toEqual({
      ok: true,
      steps: [
        { file: "tidyspec.json", result: "created" },
        { file: "AGENTS.md", result: "created" },
        { file: ".git/hooks/pre-commit", result: "created" },
      ],
      notes: [],
    });
    expect(JSON.parse(read(repo, "tidyspec.json"))).toEqual({
      language: "en",
      screens: ["docs/screens/**/*.md"],
    });
    expect(read(repo, "AGENTS.md")).toContain(BLOCK_START);
    expect(read(repo, ".git/hooks/pre-commit")).toBe(HOOK_SCRIPT);
    expect(statSync(path.join(repo.dir, ".git/hooks/pre-commit")).mode & 0o111).not.toBe(0);
  });

  it("dryRun は同じ結果を返し、何も書かない", async () => {
    const repo = newRepo();
    const dry = await applyInit(repo.dir, ANSWERS, { dryRun: true });
    expect(
      has(repo, "tidyspec.json") || has(repo, "AGENTS.md") || has(repo, ".git/hooks/pre-commit"),
    ).toBe(false);
    expect(await applyInit(repo.dir, ANSWERS, { dryRun: false })).toEqual(dry);
  });

  it("二回目は全て unchanged で、ファイルは変わらない", async () => {
    const repo = newRepo();
    await applyInit(repo.dir, ANSWERS, { dryRun: false });
    const before = [
      read(repo, "tidyspec.json"),
      read(repo, "AGENTS.md"),
      read(repo, ".git/hooks/pre-commit"),
    ];
    const again = await applyInit(repo.dir, ANSWERS, { dryRun: false });
    expect(again).toMatchObject({
      ok: true,
      steps: [{ result: "unchanged" }, { result: "unchanged" }, { result: "unchanged" }],
    });
    expect([
      read(repo, "tidyspec.json"),
      read(repo, "AGENTS.md"),
      read(repo, ".git/hooks/pre-commit"),
    ]).toEqual(before);
  });

  it("既存の設定の他のキーを残し、言語と置き場だけ更新する", async () => {
    const repo = newRepo();
    repo.write("tidyspec.json", '{"maxLineLength":50,"implementation":["lib/**"]}');
    await applyInit(
      repo.dir,
      { ...ANSWERS, language: "ja", screensDir: "specs" },
      { dryRun: false },
    );
    expect(JSON.parse(read(repo, "tidyspec.json"))).toEqual({
      maxLineLength: 50,
      implementation: ["lib/**"],
      language: "ja",
      screens: ["specs/**/*.md"],
    });
    expect(read(repo, "AGENTS.md")).toContain("50文字まで");
  });

  it("壊れた設定は、上書きせずにエラー", async () => {
    const repo = newRepo();
    repo.write("tidyspec.json", '{"screen":["x"]}');
    expect(await applyInit(repo.dir, ANSWERS, { dryRun: false })).toMatchObject({ ok: false });
    expect(read(repo, "tidyspec.json")).toBe('{"screen":["x"]}');
  });

  it("AGENTS.md の既存の文章を残す。目印が壊れていたら、どれも書かずにエラー", async () => {
    const repo = newRepo();
    repo.write("AGENTS.md", "# Mine\n\nKeep this.\n");
    await applyInit(repo.dir, ANSWERS, { dryRun: false });
    expect(read(repo, "AGENTS.md").startsWith("# Mine\n\nKeep this.\n\n")).toBe(true);

    const broken = newRepo();
    broken.write("AGENTS.md", `${BLOCK_START}\nhalf\n`);
    const result = await applyInit(broken.dir, ANSWERS, { dryRun: false });
    expect(result).toMatchObject({ ok: false });
    expect(has(broken, "tidyspec.json")).toBe(false);
  });

  it("既存の別のフックは触らず、書き方を案内する", async () => {
    const repo = newRepo();
    mkdirSync(path.join(repo.dir, ".git/hooks"), { recursive: true });
    writeFileSync(path.join(repo.dir, ".git/hooks/pre-commit"), "#!/bin/sh\necho mine\n");
    const result = await applyInit(repo.dir, ANSWERS, { dryRun: false });
    expect(result).toMatchObject({
      ok: true,
      steps: [{}, {}, { file: ".git/hooks/pre-commit", result: "skipped" }],
    });
    expect(result.ok && result.notes[0]).toContain("npx --no-install tidyspec check");
    expect(read(repo, ".git/hooks/pre-commit")).toBe("#!/bin/sh\necho mine\n");
  });

  it("core.hooksPath があるときは（husky など）フックを書かず、案内する", async () => {
    const repo = newRepo();
    repo.git("config", "core.hooksPath", ".husky");
    const result = await applyInit(repo.dir, ANSWERS, { dryRun: false });
    expect(result.ok && result.notes[0]).toContain('core.hooksPath is set to ".husky"');
    expect(has(repo, ".git/hooks/pre-commit")).toBe(false);
  });

  it("古い自分たちのフックは更新する", async () => {
    const repo = newRepo();
    mkdirSync(path.join(repo.dir, ".git/hooks"), { recursive: true });
    writeFileSync(
      path.join(repo.dir, ".git/hooks/pre-commit"),
      "#!/bin/sh\n# tidyspec:start old\nexit 0\n# tidyspec:end\n",
    );
    const result = await applyInit(repo.dir, ANSWERS, { dryRun: false });
    expect(result).toMatchObject({ ok: true, steps: [{}, {}, { result: "updated" }] });
    expect(read(repo, ".git/hooks/pre-commit")).toBe(HOOK_SCRIPT);
  });

  it("CLAUDE.md が AGENTS.md に触れていなければ、案内する", async () => {
    const repo = newRepo();
    repo.write("CLAUDE.md", "# Claude\n");
    const result = await applyInit(repo.dir, ANSWERS, { dryRun: false });
    expect(result.ok && result.notes[0]).toContain("@AGENTS.md");
    repo.write("CLAUDE.md", "@AGENTS.md\n");
    expect(await applyInit(repo.dir, ANSWERS, { dryRun: false })).toMatchObject({ notes: [] });
  });

  it("--no-hook と --no-instructions 相当は skipped にする", async () => {
    const repo = newRepo();
    const result = await applyInit(
      repo.dir,
      { ...ANSWERS, installHook: false, writeInstructions: false },
      { dryRun: false },
    );
    expect(result).toMatchObject({
      steps: [{ result: "created" }, { result: "skipped" }, { result: "skipped" }],
    });
    expect(has(repo, "AGENTS.md")).toBe(false);
  });
});

describe("入れたフックが、実際のコミットで効く", () => {
  const SCREEN = (code: string) =>
    `# Login\n\n## Spec\n\n- Sign in\n\n## Design\n\n- Lock\n\n## Code\n\n${code}\n\n## Data\n\n- users\n`;

  async function repoWithHook() {
    const repo = newRepo();
    repo.write("src/a.ts", "1");
    repo.write("docs/screens/login.md", SCREEN("- Lock: src/a.ts"));
    repo.commit("screens");
    await applyInit(repo.dir, ANSWERS, { dryRun: false });
    return repo;
  }

  /** tidyspec の実行ファイルの代わりに、終了コードだけ返す小さなスクリプトを置く。 */
  function fakeBin(repo: TestRepo, exitCode: number) {
    const bin = path.join(repo.dir, "node_modules/.bin/tidyspec");
    mkdirSync(path.dirname(bin), { recursive: true });
    writeFileSync(bin, `#!/bin/sh\necho "fake tidyspec: $@" >&2\nexit ${exitCode}\n`);
    chmodSync(bin, 0o755);
  }

  function commit(repo: TestRepo) {
    const result = spawnSync(
      "git",
      ["-C", repo.dir, "commit", "-q", "-m", "change", "--allow-empty"],
      {
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
      },
    );
    return { code: result.status, stderr: result.stderr };
  }

  it("tidyspec が問題なしなら、コミットできる", async () => {
    const repo = await repoWithHook();
    fakeBin(repo, 0);
    expect(commit(repo).code).toBe(0);
  });

  it("tidyspec が問題ありと言ったら、そのコードでコミットを止める", async () => {
    const repo = await repoWithHook();
    for (const code of [1, 2]) {
      fakeBin(repo, code);
      const result = commit(repo);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("fake tidyspec: check");
    }
  });

  it("tidyspec が入っていないチェックアウトでは、知らせてコミットは通す", async () => {
    const repo = await repoWithHook();
    const result = commit(repo);
    expect(result.code).toBe(0);
  });
});

describe("tidyspec init（CLI）", () => {
  it("端末が無く --yes も無ければ、聞かずにエラーで止まる", async () => {
    const repo = newRepo();
    const result = await exec(["init"], repo.dir);
    expect(result.code).toBe(2);
    expect(result.err).toContain("--yes");
    expect(has(repo, "tidyspec.json")).toBe(false);
  });

  it("--yes は聞かずに、フラグか既定値で入れる", async () => {
    const repo = newRepo();
    const result = await exec(
      ["init", "--yes", "--lang", "ja", "--screens-dir", "specs", "--no-hook"],
      repo.dir,
    );
    expect(result.code).toBe(0);
    expect(result.out).toContain("created   tidyspec.json");
    expect(result.out).toContain("skipped   pre-commit hook");
    expect(JSON.parse(read(repo, "tidyspec.json"))).toEqual({
      language: "ja",
      screens: ["specs/**/*.md"],
    });
    expect(read(repo, "AGENTS.md")).toContain("画面の仕様");
  });

  it("質問に答えて入れる。聞くのは、フラグで決まっていないことだけ", async () => {
    const repo = newRepo();
    const prompt = scripted(["ja", "specs", true, true, true]);
    const result = await exec(["init"], repo.dir, prompt);
    expect(result.code).toBe(0);
    expect(prompt.asked).toHaveLength(5);
    expect(JSON.parse(read(repo, "tidyspec.json"))).toEqual({
      language: "ja",
      screens: ["specs/**/*.md"],
    });

    const flagged = newRepo();
    const some = scripted([true, true]);
    await exec(
      ["init", "--lang", "en", "--screens-dir", "docs/screens", "--no-hook"],
      flagged.dir,
      some,
    );
    expect(some.asked).toEqual([
      "Add the screen-spec instructions for coding agents to AGENTS.md?",
      "Apply these changes?",
    ]);
  });

  it("最後の確認で断ると、何も書かない", async () => {
    const repo = newRepo();
    const result = await exec(["init"], repo.dir, scripted(["en", "", true, true, false]));
    expect(result.code).toBe(0);
    expect(result.out).toContain("Nothing changed.");
    expect(
      has(repo, "tidyspec.json") || has(repo, "AGENTS.md") || has(repo, ".git/hooks/pre-commit"),
    ).toBe(false);
  });

  it("使えない置き場と、知らない言語は 2 で、何も書かない", async () => {
    const repo = newRepo();
    expect((await exec(["init", "--yes", "--screens-dir", "../x"], repo.dir)).code).toBe(2);
    const lang = await exec(["init", "--yes", "--lang", "fr"], repo.dir);
    expect(lang.code).toBe(2);
    expect(lang.err).toContain("--lang must be en or ja");
    expect(has(repo, "tidyspec.json")).toBe(false);
  });

  it("init したあとの check と status が、その設定で動く", async () => {
    const repo = newRepo();
    await exec(["init", "--yes", "--no-hook"], repo.dir);
    repo.write(
      "docs/screens/login.md",
      `# Login\n\n## Spec\n\n- Sign in\n\n## Design\n\n- Lock\n\n## Code\n\n- Lock: src/a.ts\n\n## Data\n\n- users\n`,
    );
    repo.write("src/a.ts", "1");
    repo.commit("add screen");
    expect(await exec(["status"], repo.dir)).toEqual({
      code: 0,
      out: "docs/screens/login.md: up to date",
      err: "",
    });
  });
});
