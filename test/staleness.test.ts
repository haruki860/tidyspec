import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkStaleness } from "../src/staleness.js";
import { TestRepo } from "./helpers/repo.js";

const made: TestRepo[] = [];
const dirs: string[] = [];

function repoWith(files: Record<string, string> = { "a.ts": "1", "login.md": "# ログイン\n" }) {
  const repo = TestRepo.create();
  made.push(repo);
  for (const [file, content] of Object.entries(files)) repo.write(file, content);
  repo.commit("initial");
  return repo;
}

function check(repo: TestRepo, code: string[] = ["a.ts"], screen = "login.md") {
  return checkStaleness({ repo: repo.dir, screen, code });
}

afterEach(() => {
  for (const repo of made.splice(0)) repo.remove();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// docs/staleness-cases.md の番号と対応する
describe("staleness", () => {
  it("1: 実装と画面を同じコミットで追加すると揃っている", async () => {
    const report = await check(repoWith());
    expect(report.status).toBe("aligned");
    expect(report.files).toEqual([{ path: "a.ts", state: "aligned" }]);
  });

  it("2: 実装だけ変えると、実装の方が新しい", async () => {
    const repo = repoWith();
    repo.write("a.ts", "2");
    repo.commit("change impl");
    const report = await check(repo);
    expect(report.status).toBe("stale");
    expect(report.files).toEqual([{ path: "a.ts", state: "stale" }]);
  });

  it("3: そのあと画面を変えると揃っている", async () => {
    const repo = repoWith();
    repo.write("a.ts", "2");
    repo.commit("change impl");
    repo.write("login.md", "# ログイン\n\n- 変えた\n");
    repo.commit("update spec");
    expect((await check(repo)).status).toBe("aligned");
  });

  it("4: 実装を知らない枝で画面を変えてマージしても、実装の方が新しい", async () => {
    const repo = repoWith();
    repo.git("checkout", "-q", "-b", "spec");
    repo.write("login.md", "# ログイン\n\n- 枝で変えた\n");
    repo.commit("spec on branch");
    repo.git("checkout", "-q", "main");
    repo.write("a.ts", "2");
    repo.commit("impl on main");
    repo.git("merge", "-q", "--no-ff", "-m", "merge", "spec");
    expect((await check(repo)).status).toBe("stale");
  });

  it("4b: 実装を取り込んだ枝で画面を変えてマージすると揃っている", async () => {
    const repo = repoWith();
    repo.git("checkout", "-q", "-b", "spec");
    repo.git("checkout", "-q", "main");
    repo.write("a.ts", "2");
    repo.commit("impl on main");
    repo.git("checkout", "-q", "spec");
    repo.git("merge", "-q", "--no-ff", "-m", "merge main", "main");
    repo.write("login.md", "# ログイン\n\n- 取り込んだあとで変えた\n");
    repo.commit("spec after merge");
    repo.git("checkout", "-q", "main");
    repo.git("merge", "-q", "--no-ff", "-m", "merge spec", "spec");
    expect((await check(repo)).status).toBe("aligned");
  });

  it("5: squash で実装と画面が同じコミットになると揃っている", async () => {
    const repo = repoWith();
    repo.write("a.ts", "2");
    repo.commit("impl");
    repo.write("login.md", "# ログイン\n\n- 変えた\n");
    repo.commit("spec");
    repo.git("reset", "-q", "--soft", "HEAD~2");
    repo.commit("squashed");
    expect((await check(repo)).status).toBe("aligned");
  });

  it("6: 複数ファイルのうち片方だけ新しいと、そのファイルを出す", async () => {
    const repo = repoWith({ "a.ts": "1", "b.ts": "1", "login.md": "# ログイン\n" });
    repo.write("b.ts", "2");
    repo.commit("change b");
    const report = await check(repo, ["a.ts", "b.ts"]);
    expect(report.status).toBe("stale");
    expect(report.files).toEqual([
      { path: "a.ts", state: "aligned" },
      { path: "b.ts", state: "stale" },
    ]);
  });

  it("7: 画面が指さないファイルの変更は影響しない", async () => {
    const repo = repoWith({ "a.ts": "1", "other.ts": "1", "login.md": "# ログイン\n" });
    repo.write("other.ts", "2");
    repo.commit("change other");
    expect((await check(repo)).status).toBe("aligned");
  });

  it("8: 改名した実装は、旧パスなら無く、新パスなら改名のコミットで新しい", async () => {
    const repo = repoWith();
    repo.git("mv", "a.ts", "b.ts");
    repo.commit("rename");
    const oldPath = await check(repo, ["a.ts"]);
    expect(oldPath.status).toBe("missing");
    expect(oldPath.files).toEqual([{ path: "a.ts", state: "missing" }]);
    expect((await check(repo, ["b.ts"])).status).toBe("stale");
  });

  it("9: 削除した実装は無い", async () => {
    const repo = repoWith();
    repo.git("rm", "-q", "a.ts");
    repo.commit("delete");
    expect((await check(repo)).status).toBe("missing");
  });

  it("10: 未追跡の新規ファイルは、コミットされるまで比べない", async () => {
    const repo = repoWith();
    repo.write("c.ts", "new");
    const report = await check(repo, ["a.ts", "c.ts"]);
    expect(report.status).toBe("aligned");
    expect(report.files[1]).toEqual({ path: "c.ts", state: "untracked" });
  });

  it("11: 実装に未コミットの変更があり、画面が無変更なら作業中の差分あり", async () => {
    const repo = repoWith();
    repo.write("a.ts", "edited");
    expect((await check(repo)).status).toBe("working-changes");
  });

  it("11b: 画面も未コミットで変えていれば揃っている", async () => {
    const repo = repoWith();
    repo.write("a.ts", "edited");
    repo.write("login.md", "# ログイン\n\n- 書いている途中\n");
    expect((await check(repo)).status).toBe("aligned");
  });

  it("11c: 画面が新規で未コミットでも揃っている", async () => {
    const repo = repoWith({ "a.ts": "1" });
    repo.write("login.md", "# ログイン\n");
    expect((await check(repo)).status).toBe("aligned");
  });

  it("12: 日時が逆順でも、祖先関係で決める", async () => {
    const repo = repoWith();
    repo.write("a.ts", "2");
    repo.commit("impl with an old clock", Date.UTC(2000, 0, 1) / 1000);
    expect((await check(repo)).status).toBe("stale");
  });

  it("13: 同じ実装を載せる画面は、全部が新しいと出る", async () => {
    const repo = repoWith({
      "a.ts": "1",
      "login.md": "# ログイン\n",
      "new.md": "# カートに入れる\n",
    });
    repo.write("a.ts", "2");
    repo.commit("change shared");
    expect((await check(repo, ["a.ts"], "login.md")).status).toBe("stale");
    expect((await check(repo, ["a.ts"], "new.md")).status).toBe("stale");
  });

  it("16: git 管理でないと古さは出さず、参照の実在だけ見る", async () => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tidyspec-nogit-")));
    dirs.push(dir);
    writeFileSync(path.join(dir, "a.ts"), "1");
    writeFileSync(path.join(dir, "login.md"), "# ログイン\n");
    const ok = await checkStaleness({ repo: dir, screen: "login.md", code: ["a.ts"] });
    expect(ok.status).toBe("no-git");
    expect(ok.files).toEqual([{ path: "a.ts", state: "unchecked" }]);
    const gone = await checkStaleness({ repo: dir, screen: "login.md", code: ["a.ts", "x.ts"] });
    expect(gone.status).toBe("missing");
  });

  it("17: 浅い clone では、揃っているとは言わない", async () => {
    const repo = repoWith();
    repo.write("a.ts", "2");
    repo.commit("second");
    const parent = realpathSync(mkdtempSync(path.join(tmpdir(), "tidyspec-clone-")));
    dirs.push(parent);
    const clone = path.join(parent, "shallow");
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${repo.dir}`, clone]);
    const report = await checkStaleness({ repo: clone, screen: "login.md", code: ["a.ts"] });
    expect(report.status).toBe("unknown");
  });

  it("コードの行が repo の外を指しても、無いものとして扱う", async () => {
    const repo = repoWith();
    const report = await check(repo, ["../outside.ts", "/etc/hosts"]);
    expect(report.status).toBe("missing");
    expect(report.files.map((f) => f.state)).toEqual(["missing", "missing"]);
  });

  it("コードの行がパス指定の記法に見えても、文字どおりのファイル名として扱う", async () => {
    const repo = repoWith({
      "a.ts": "1",
      ":(glob)*.ts": "1",
      "-x.ts": "1",
      "login.md": "# ログイン\n",
    });
    repo.write("a.ts", "2");
    repo.commit("change a.ts only");
    repo.write("login.md", "# ログイン\n\n- 変えた\n");
    repo.commit("spec");
    repo.write("a.ts", "3");
    repo.commit("change a.ts again");
    // ":(glob)*.ts" が記法として解釈されると a.ts にも当たり、新しいと出てしまう
    const report = await check(repo, [":(glob)*.ts", "-x.ts"]);
    expect(report.files).toEqual([
      { path: ":(glob)*.ts", state: "aligned" },
      { path: "-x.ts", state: "aligned" },
    ]);
  });

  it("画面のファイルが無いと例外", async () => {
    const repo = repoWith();
    await expect(check(repo, ["a.ts"], "nope.md")).rejects.toThrow("screen file not found");
  });
});
