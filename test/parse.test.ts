import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_LINE_LENGTH,
  hasErrors,
  type ParseOptions,
  parseScreen as parseWith,
  splitCodeLine,
} from "../src/parse.js";

// このファイルのフィクスチャは日本語の見出し
const parseScreen = (source: string, options: ParseOptions = {}) =>
  parseWith(source, { language: "ja", ...options });

const valid = `# ログイン

## 仕様

- メールで入れる
- 連続して失敗するとロックする

## 設計

- ロックは回数ではなく、連続失敗でかける

## コード

- 連続失敗の判定: src/auth/lock.ts

## データ

- users
- sessions
`;

function kinds(source: string, maxLineLength?: number) {
  return parseScreen(source, { maxLineLength }).problems.map((p) => p.kind);
}

describe("parseScreen", () => {
  it("正しい画面を読み、問題を出さない", () => {
    const { screen, problems } = parseScreen(valid);
    expect(problems).toEqual([]);
    expect(screen.title).toBe("ログイン");
    expect(screen.spec.map((i) => i.text)).toEqual([
      "メールで入れる",
      "連続して失敗するとロックする",
    ]);
    expect(screen.design).toHaveLength(1);
    expect(screen.code).toEqual([
      {
        text: "連続失敗の判定: src/auth/lock.ts",
        line: 14,
        description: "連続失敗の判定",
        path: "src/auth/lock.ts",
      },
    ]);
    expect(screen.data.map((i) => i.text)).toEqual(["users", "sessions"]);
  });

  it.each(["login.md", "cart.md"])("実在のサンプル %s に問題が無い", (name) => {
    const source = readFileSync(new URL(`../examples/shop/${name}`, import.meta.url), "utf8");
    expect(parseScreen(source).problems).toEqual([]);
  });

  it("行番号は 1 始まりで、元の行を指す", () => {
    const { screen } = parseScreen(valid);
    expect(screen.spec.map((i) => i.line)).toEqual([5, 6]);
  });

  it("CRLF と BOM を読める", () => {
    const { screen, problems } = parseScreen(`﻿${valid.replaceAll("\n", "\r\n")}`);
    expect(problems).toEqual([]);
    expect(screen.title).toBe("ログイン");
  });

  describe("見出し", () => {
    it("決まった見出しが無いと error で、どれが無いかを言う", () => {
      const { problems } = parseScreen("# ログイン\n\n## 仕様\n\n- a\n");
      expect(problems.filter((p) => p.kind === "missing-heading").map((p) => p.detail)).toEqual([
        "設計",
        "コード",
        "データ",
      ]);
      expect(hasErrors(problems)).toBe(true);
    });

    it("タイトルが無いと error", () => {
      expect(kinds(valid.replace("# ログイン\n", ""))).toEqual(["missing-title"]);
    });

    it("タイトルが二つあると error", () => {
      expect(kinds(`${valid}\n# もう一つ\n`)).toContain("duplicate-title");
    });

    it("同じ見出しが二つあると error で、後ろの中身は混ぜない", () => {
      const { screen, problems } = parseScreen(`${valid}\n## 仕様\n\n- 後から足した\n`);
      expect(problems.map((p) => p.kind)).toEqual(["duplicate-heading"]);
      expect(screen.spec).toHaveLength(2);
    });

    it("知らない見出しは warning で、中身は読み飛ばす", () => {
      const { screen, problems } = parseScreen(`${valid}\n## メモ\n\n- 余計な一行\n`);
      expect(problems.map((p) => p.kind)).toEqual(["unknown-heading"]);
      expect(hasErrors(problems)).toBe(false);
      expect(screen.data).toHaveLength(2);
    });

    it("コードブロックの中の # は見出しにしない", () => {
      const source = valid.replace(
        "- メールで入れる",
        "```\n# 見出しに見える\n## 仕様\n```\n- メールで入れる",
      );
      const { screen, problems } = parseScreen(source);
      expect(problems.map((p) => p.kind)).toEqual(["not-a-bullet"]);
      expect(screen.spec.map((i) => i.text)).toContain("メールで入れる");
    });
  });

  describe("行の長さ", () => {
    const withSpec = (text: string) => valid.replace("- メールで入れる", `- ${text}`);

    it("上限ちょうどは通り、一文字超えると error", () => {
      expect(kinds(withSpec("あ".repeat(DEFAULT_MAX_LINE_LENGTH)))).toEqual([]);
      expect(kinds(withSpec("あ".repeat(DEFAULT_MAX_LINE_LENGTH + 1)))).toEqual(["long-line"]);
    });

    it("サロゲートペアの文字は一文字と数える", () => {
      expect(kinds(withSpec("😀".repeat(DEFAULT_MAX_LINE_LENGTH)))).toEqual([]);
    });

    it("上限は引数で変えられる", () => {
      expect(kinds(withSpec("あ".repeat(40)), 40)).toEqual([]);
      expect(kinds(withSpec("あ".repeat(41)), 40)).toEqual(["long-line"]);
    });

    it("設計とコードの行も見る。データは見ない", () => {
      const long = "あ".repeat(DEFAULT_MAX_LINE_LENGTH + 1);
      expect(kinds(valid.replace("- ロックは回数ではなく、連続失敗でかける", `- ${long}`))).toEqual(
        ["long-line"],
      );
      expect(kinds(valid.replace("- users", `- ${"u".repeat(200)}`))).toEqual([]);
    });
  });

  describe("コードの行", () => {
    it("区切りの後に空白なしの語が無いと error で、code に入れない", () => {
      const { screen, problems } = parseScreen(
        valid.replace("連続失敗の判定: src/auth/lock.ts", "連続失敗の判定はここ"),
      );
      expect(problems.map((p) => p.kind)).toEqual(["code-line-without-path"]);
      expect(screen.code).toEqual([]);
    });

    // Makefile のように拡張子も / も無い実在のファイルがあるので、パスらしさは見ない。実在は staleness が見る。
    it("パスらしさは見ず、空白なしの語はパスとして取る", () => {
      const { screen, problems } = parseScreen(valid.replace("src/auth/lock.ts", "どこかにある"));
      expect(problems).toEqual([]);
      expect(screen.code.map((entry) => entry.path)).toEqual(["どこかにある"]);
    });

    it.each([
      ["判定: src/a.ts", "判定", "src/a.ts"],
      ["判定：src/a.ts", "判定", "src/a.ts"],
      ["判定: `src/a.ts`", "判定", "src/a.ts"],
      ["流れ: 送信: src/a.ts", "流れ: 送信", "src/a.ts"],
    ])("%s を分ける", (text, description, path) => {
      expect(splitCodeLine(text)).toEqual({ description, path });
    });

    it.each(["src/a.ts", "判定:", "判定: 二語 以上", ": src/a.ts"])(
      "%s はパスが取れない",
      (text) => {
        expect(splitCodeLine(text)).toBeNull();
      },
    );
  });

  describe("形の崩れ", () => {
    it("箇条書きでない文章は warning", () => {
      expect(kinds(valid.replace("- メールで入れる", "メールで入れる。"))).toEqual([
        "not-a-bullet",
      ]);
    });

    it("入れ子の箇条書きは warning で、読み取らない", () => {
      const { screen, problems } = parseScreen(
        valid.replace("- メールで入れる", "- メールで入れる\n  - 入れ子"),
      );
      expect(problems.map((p) => p.kind)).toEqual(["nested-bullet"]);
      expect(screen.spec).toHaveLength(2);
    });

    it("見出しの前の文章（古い形式のコミット行など）は warning", () => {
      const { problems } = parseScreen(
        valid.replace("# ログイン\n", "# ログイン\n\n仕様を揃えたコミット: abc1234\n"),
      );
      expect(problems.map((p) => p.kind)).toEqual(["text-outside-section"]);
    });

    it("見出しの下の三段目以降の見出しは warning", () => {
      expect(kinds(valid.replace("- メールで入れる", "### 細目\n- メールで入れる"))).toEqual([
        "unexpected-heading",
      ]);
    });

    it("空の入力は error だけで、例外にしない", () => {
      const { screen, problems } = parseScreen("");
      expect(screen.title).toBeNull();
      expect(problems.map((p) => p.kind)).toEqual([
        "missing-title",
        "missing-heading",
        "missing-heading",
        "missing-heading",
        "missing-heading",
      ]);
    });
  });
});

describe("language", () => {
  const english = readFileSync(new URL("../examples/shop-en/login.md", import.meta.url), "utf8");

  it("既定は英語の見出しで、英語のサンプルを問題なく読む", () => {
    const { screen, problems } = parseWith(english);
    expect(problems).toEqual([]);
    expect(screen.title).toBe("Login");
    expect(screen.spec).toHaveLength(3);
    expect(screen.code.map((entry) => entry.path)).toEqual([
      "src/auth/lock.ts",
      "src/auth/login.ts",
      "src/pages/login.tsx",
    ]);
    expect(screen.data.map((item) => item.text)).toEqual(["users", "sessions"]);
  });

  it("英語の設定で、日本語の見出しは決まった見出しとして読まれない", () => {
    const { problems } = parseWith(valid);
    expect(problems.filter((p) => p.kind === "unknown-heading")).toHaveLength(4);
    expect(problems.filter((p) => p.kind === "missing-heading").map((p) => p.detail)).toEqual([
      "Spec",
      "Design",
      "Code",
      "Data",
    ]);
  });

  it("日本語の設定で、英語の見出しは読まれず、無い見出しは日本語名で言う", () => {
    const { problems } = parseWith(english, { language: "ja" });
    expect(problems.filter((p) => p.kind === "missing-heading").map((p) => p.detail)).toEqual([
      "仕様",
      "設計",
      "コード",
      "データ",
    ]);
  });

  it("英語でも、データの行は長さを見ず、他の行は見る", () => {
    const long = "a".repeat(DEFAULT_MAX_LINE_LENGTH + 1);
    expect(parseWith(english.replace("- users", `- ${long}`)).problems).toEqual([]);
    expect(
      parseWith(
        english.replace("The lock is per account, never per IP address", long),
      ).problems.map((p) => p.kind),
    ).toEqual(["long-line"]);
  });
});
