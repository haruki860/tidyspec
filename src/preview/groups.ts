import path from "node:path";
import type { ScreenInspection } from "../checks/status.js";

export interface ScreenGroup {
  /** 画面ファイルのあるディレクトリ（共通の部分を除く）。直下なら空 */
  name: string;
  views: ScreenInspection[];
}

function segmentsOf(directory: string): string[] {
  return directory === "." ? [] : directory.split("/");
}

/** 全ての画面のディレクトリに共通する先頭の部分（`docs/screens` など）の段数。 */
function commonDepth(directories: string[][]): number {
  const first = directories[0] ?? [];
  let depth = 0;
  while (depth < first.length && directories.every((dir) => dir[depth] === first[depth]))
    depth += 1;
  return depth;
}

/** 直下（空の名前）を先に、あとは名前の順。 */
function compareNames(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "") return -1;
  if (b === "") return 1;
  return a.localeCompare(b);
}

/**
 * 画面を、置かれたディレクトリごとにまとめる。全ての画面に共通する上のディレクトリは、名前に入れない。
 * 直下の画面（名前が空）が先、あとはディレクトリ名の順。画面の並びは入力の順を保つ。
 */
export function groupScreens(views: ScreenInspection[]): ScreenGroup[] {
  const directories = views.map((view) => segmentsOf(path.posix.dirname(view.screen)));
  const depth = commonDepth(directories);
  const groups = new Map<string, ScreenInspection[]>();
  views.forEach((view, i) => {
    const name = (directories[i] ?? []).slice(depth).join("/");
    groups.set(name, [...(groups.get(name) ?? []), view]);
  });
  return [...groups]
    .sort(([a], [b]) => compareNames(a, b))
    .map(([name, grouped]) => ({ name, views: grouped }));
}
