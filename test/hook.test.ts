import { afterEach, describe, expect, it } from "vitest";
import { checkCommit } from "../src/hook.js";
import { TestRepo } from "./helpers/repo.js";

const made: TestRepo[] = [];
afterEach(() => {
  for (const repo of made.splice(0)) repo.remove();
});

const screen = (code = "- 連続失敗の判定: src/auth/lock.ts") => `# ログイン

## 仕様

- メールで入れる

## 設計

- 連続失敗でロックする

## コード

${code}

## データ

- users
`;

const LOGIN = "docs/screens/login.md";
const NEW_POST = "docs/screens/order.md";

/** 画面2枚と実装が、コミット済みのリポジトリ。 */
function baseRepo() {
  const repo = TestRepo.create();
  made.push(repo);
  repo.write(LOGIN, screen());
  repo.write(NEW_POST, screen("- 判定: src/auth/lock.ts"));
  repo.write("src/auth/lock.ts", "1");
  repo.write("src/other.ts", "1");
  repo.write("README.md", "1");
  repo.commit("initial");
  return repo;
}

function stage(repo: TestRepo) {
  repo.git("add", "-A");
}

const kinds = async (repo: TestRepo) => (await checkCommit(repo.dir)).violations.map((v) => v.kind);

// docs/staleness-cases.md の H1〜H7 に対応する
describe("checkCommit", () => {
  it("何もステージしていなければ通す", async () => {
    expect((await checkCommit(baseRepo().dir)).ok).toBe(true);
  });

  it("H1: 見出しが欠けた画面は止める", async () => {
    const repo = baseRepo();
    repo.write(LOGIN, screen().replace("## 設計\n\n- 連続失敗でロックする\n\n", ""));
    stage(repo);
    const report = await checkCommit(repo.dir);
    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      { kind: "screen-problem", screen: LOGIN, problem: { kind: "missing-heading", line: null, detail: "設計" } },
    ]);
  });

  it("H2: 長すぎる行は止める", async () => {
    const repo = baseRepo();
    repo.write(LOGIN, screen().replace("メールで入れる", "あ".repeat(81)));
    stage(repo);
    expect(await kinds(repo)).toEqual(["screen-problem"]);
  });

  it("H3: コードの行にパスが無いと止める", async () => {
    const repo = baseRepo();
    repo.write(LOGIN, screen("- 判定はここ"));
    stage(repo);
    const report = await checkCommit(repo.dir);
    expect(report.violations).toMatchObject([{ kind: "screen-problem", problem: { kind: "code-line-without-path" } }]);
  });

  it.each(["src/nothing.ts", "../outside.ts", "/etc/hosts", "src"])("H3: コードの行が指す %s が無いと止める", async (target) => {
    const repo = baseRepo();
    repo.write(LOGIN, screen(`- 判定: ${target}`));
    stage(repo);
    const report = await checkCommit(repo.dir);
    expect(report.violations).toEqual([{ kind: "code-file-missing", screen: LOGIN, line: 13, path: target }]);
  });

  it("H4: 載っている実装だけを変えると止め、載せている画面を全部言う", async () => {
    const repo = baseRepo();
    repo.write("src/auth/lock.ts", "2");
    stage(repo);
    const report = await checkCommit(repo.dir);
    expect(report.violations).toEqual([
      { kind: "spec-not-updated", file: "src/auth/lock.ts", screens: [LOGIN, NEW_POST] },
    ]);
  });

  it("H5: 載せている画面のうち一つでも変われば通す", async () => {
    const repo = baseRepo();
    repo.write("src/auth/lock.ts", "2");
    repo.write(LOGIN, screen().replace("メールで入れる", "メールで入れる。変えた"));
    stage(repo);
    expect((await checkCommit(repo.dir)).ok).toBe(true);
  });

  it("H6: どの画面にも載っていない実装は止めず、未登録として知らせる", async () => {
    const repo = baseRepo();
    repo.write("src/other.ts", "2");
    stage(repo);
    const report = await checkCommit(repo.dir);
    expect(report.ok).toBe(true);
    expect(report.unregistered).toEqual(["src/other.ts"]);
  });

  it("H7: 実装のパターンに入らないファイルは、止めず、未登録にも出さない", async () => {
    const repo = baseRepo();
    repo.write("README.md", "2");
    stage(repo);
    const report = await checkCommit(repo.dir);
    expect(report.ok).toBe(true);
    expect(report.unregistered).toEqual([]);
  });

  it("別の画面から参照されている画面を直しても、その参照元の更新は求めない", async () => {
    const repo = baseRepo();
    repo.write(NEW_POST, screen(`- 関連する画面: ${LOGIN}`));
    repo.commit("cart refers to login");
    repo.write(LOGIN, screen().replace("メールで入れる", "メールで入れる。変えた"));
    stage(repo);
    expect((await checkCommit(repo.dir)).ok).toBe(true);
  });

  it("載っている実装を消したのに画面が動いていないと止める", async () => {
    const repo = baseRepo();
    repo.git("rm", "-q", "src/auth/lock.ts");
    expect(await kinds(repo)).toEqual(["spec-not-updated"]);
  });

  it("載っている実装を消し、画面が古いパスのままなら、パスの無さで止める", async () => {
    const repo = baseRepo();
    repo.git("rm", "-q", "src/auth/lock.ts");
    repo.write(LOGIN, screen().replace("メールで入れる", "メールで入れる。変えた"));
    stage(repo);
    expect(await kinds(repo)).toEqual(["code-file-missing"]);
  });

  it("改名は、旧パスを載せた画面が動かないと止める", async () => {
    const repo = baseRepo();
    repo.git("mv", "src/auth/lock.ts", "src/auth/guard.ts");
    expect(await kinds(repo)).toEqual(["spec-not-updated"]);
    repo.write(LOGIN, screen("- 連続失敗の判定: src/auth/guard.ts"));
    repo.write(NEW_POST, screen("- 判定: src/auth/guard.ts"));
    stage(repo);
    expect((await checkCommit(repo.dir)).ok).toBe(true);
  });

  it("ステージされた内容を検査する。作業ツリーだけ直しても通らない", async () => {
    const repo = baseRepo();
    repo.write(LOGIN, screen("- 判定はここ"));
    stage(repo);
    repo.write(LOGIN, screen());
    expect(await kinds(repo)).toEqual(["screen-problem"]);
  });

  it("触っていない画面が崩れていても、関係ないコミットは止めない", async () => {
    const repo = baseRepo();
    repo.write(NEW_POST, "壊れている");
    repo.commit("break another screen");
    repo.write("README.md", "2");
    stage(repo);
    expect((await checkCommit(repo.dir)).ok).toBe(true);
  });

  it("warning は止めずに知らせる", async () => {
    const repo = baseRepo();
    repo.write(LOGIN, `${screen()}\n## メモ\n\n- 余計\n`);
    stage(repo);
    const report = await checkCommit(repo.dir);
    expect(report.ok).toBe(true);
    expect(report.warnings).toMatchObject([{ screen: LOGIN, problem: { kind: "unknown-heading" } }]);
  });

  it("日本語のファイル名の画面も読める", async () => {
    const repo = baseRepo();
    repo.write("docs/screens/ログイン.md", screen("- 判定はここ"));
    stage(repo);
    expect(await kinds(repo)).toEqual(["screen-problem"]);
  });

  it("最初のコミット（HEAD が無い）でも検査できる", async () => {
    const repo = TestRepo.create();
    made.push(repo);
    repo.write(LOGIN, screen());
    repo.write("src/auth/lock.ts", "1");
    stage(repo);
    expect((await checkCommit(repo.dir)).ok).toBe(true);
  });

  it("設定で画面の置き場と実装のパターンを変えられる", async () => {
    const repo = TestRepo.create();
    made.push(repo);
    repo.write("specs/login.md", screen());
    repo.write("src/auth/lock.ts", "1");
    repo.commit("initial");
    repo.write("src/auth/lock.ts", "2");
    stage(repo);
    const report = await checkCommit(repo.dir, { screens: ["specs/*.md"], implementation: [] });
    expect(report.violations).toEqual([{ kind: "spec-not-updated", file: "src/auth/lock.ts", screens: ["specs/login.md"] }]);
  });
});
