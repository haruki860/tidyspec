import type { Language } from "../core/language.js";
import type { ScreenStatus } from "../repo/staleness.js";

/** 表示だけで使う言葉。画面ファイルについての指摘の文言は core/messages にある。 */
export interface Labels {
  screens: string;
  back: string;
  noScreens: string;
  problems: string;
  ungrouped: string;
  notInSchema: string;
  onThisPage: string;
  lastChange: string;
  truncated: string;
  summary(total: number, behind: number): string;
  screenStatus: Record<ScreenStatus, string>;
}

export const LABELS: Record<Language, Labels> = {
  en: {
    screens: "Screens",
    back: "All screens",
    noScreens: "No screens found",
    problems: "Problems",
    ungrouped: "General",
    notInSchema: "not in the schema",
    onThisPage: "On this page",
    lastChange: "Last change to this spec",
    truncated: "Showing the first lines only",
    summary: (total, behind) => `${total} screens · ${behind} need attention`,
    screenStatus: {
      aligned: "up to date",
      stale: "code is newer",
      "working-changes": "uncommitted changes",
      missing: "file not found",
      unknown: "not checked (shallow clone)",
      "no-git": "not checked (no git)",
    },
  },
  ja: {
    screens: "画面",
    back: "画面の一覧",
    noScreens: "画面が見つかりません",
    problems: "指摘",
    ungrouped: "全般",
    notInSchema: "スキーマにない",
    onThisPage: "このページ",
    lastChange: "この仕様の直近の変更",
    truncated: "先頭の行だけ表示しています",
    summary: (total, behind) => `${total} 画面 · 要確認 ${behind}`,
    screenStatus: {
      aligned: "揃っている",
      stale: "実装の方が新しい",
      "working-changes": "作業中の差分あり",
      missing: "ファイルがない",
      unknown: "未確認（履歴が浅い）",
      "no-git": "未確認（git なし）",
    },
  },
};
