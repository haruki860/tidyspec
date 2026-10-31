import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { devNull, tmpdir } from "node:os";
import path from "node:path";

const BASE_TIME = Date.UTC(2026, 0, 1) / 1000;

// 一時的な git リポジトリ。履歴を作って、古さ判定の期待値を確かめる。
export class TestRepo {
  private tick = 0;
  private constructor(readonly dir: string) {}

  static create(): TestRepo {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), "tidyspec-")));
    const repo = new TestRepo(dir);
    repo.git("init", "-q", "-b", "main");
    repo.git("config", "user.name", "Test");
    repo.git("config", "user.email", "test@example.com");
    repo.git("config", "commit.gpgsign", "false");
    return repo;
  }

  git(...args: string[]): string {
    return this.run(args, {});
  }

  write(file: string, content: string): void {
    const target = path.join(this.dir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  /** 全部をステージして、コミットする。date を渡すと、日時だけ指定できる（時計のずれの再現）。 */
  commit(message: string, date?: number): string {
    this.git("add", "-A");
    const when = `${date ?? BASE_TIME + ++this.tick} +0000`;
    this.run(["commit", "-q", "-m", message], {
      GIT_AUTHOR_DATE: when,
      GIT_COMMITTER_DATE: when,
    });
    return this.git("rev-parse", "HEAD");
  }

  remove(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }

  private run(args: string[], env: Record<string, string>): string {
    return execFileSync("git", ["-C", this.dir, ...args], {
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_SYSTEM: devNull, ...env },
    }).trim();
  }
}
