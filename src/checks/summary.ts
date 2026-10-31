import type { Config } from "../config.js";
import { changedLines, type DiffLine } from "../core/diff.js";
import { parseScreen } from "../core/parse.js";
import { git } from "../repo/git.js";
import { repoRelativePath } from "../repo/paths.js";

/** 画面一つについて表示する、変更行の上限。PR の本文を埋め尽くさない。 */
export const MAX_SUMMARY_LINES = 40;

export type ScreenChange = "added" | "modified" | "removed";

export interface ChangedScreen {
  screen: string;
  title: string | null;
  change: ScreenChange;
  lines: DiffLine[];
  truncated: boolean;
}

/** 載せている実装は変わったのに、画面の Markdown が変わっていないもの。 */
export interface BehindScreen {
  screen: string;
  title: string | null;
  files: string[];
}

export interface Summary {
  /** 比べた相手のコミット（merge-base ではなく、指定を解決したもの） */
  base: string;
  changed: ChangedScreen[];
  behind: BehindScreen[];
}

export type SummaryResult = { ok: true; summary: Summary } | { ok: false; error: string };

const BASE_CANDIDATES = ["origin/HEAD", "main", "master"];

async function commitOf(repo: string, ref: string): Promise<string | undefined> {
  const result = await git(repo, [
    "rev-parse",
    "--verify",
    "--quiet",
    "--end-of-options",
    `${ref}^{commit}`,
  ]);
  const hash = result.stdout.trim();
  return result.code === 0 && hash !== "" ? hash : undefined;
}

/** 指定があればそれ、無ければ origin/HEAD、main、master の順に、あるものを使う。 */
async function resolveBase(repo: string, option: string | undefined): Promise<string | undefined> {
  if (option !== undefined) return option.startsWith("-") ? undefined : commitOf(repo, option);
  for (const candidate of BASE_CANDIDATES) {
    const hash = await commitOf(repo, candidate);
    if (hash !== undefined) return hash;
  }
  return undefined;
}

async function gitOutput(repo: string, args: string[], glob = false): Promise<string> {
  const result = await git(repo, args, { globPathspecs: glob });
  if (result.code !== 0) throw new Error(`git ${args[0] ?? ""} failed (exit ${result.code})`);
  return result.stdout;
}

/** base と HEAD の共通の祖先から HEAD までに変わったファイルと、その種類（A / M / D）。 */
async function changedFiles(
  repo: string,
  range: string,
  pathspecs: string[] | undefined,
): Promise<Map<string, string>> {
  const tail = pathspecs === undefined ? [] : ["--", ...pathspecs];
  const out = await gitOutput(
    repo,
    ["diff", "--name-status", "-z", "--no-renames", range, ...tail],
    pathspecs !== undefined,
  );
  const fields = out.split("\0").filter((field) => field !== "");
  const files = new Map<string, string>();
  for (let i = 0; i + 1 < fields.length; i += 2) files.set(fields[i + 1] ?? "", fields[i] ?? "");
  return files;
}

async function blobAt(repo: string, rev: string, file: string): Promise<string | undefined> {
  const result = await git(repo, ["cat-file", "blob", `${rev}:${file}`]);
  return result.code === 0 ? result.stdout : undefined;
}

async function readScreen(context: { repo: string; config: Config }, revs: string[], file: string) {
  const { repo, config } = context;
  for (const rev of revs) {
    const source = await blobAt(repo, rev, file);
    if (source !== undefined) {
      const { screen } = parseScreen(source, {
        maxLineLength: config.maxLineLength,
        language: config.language,
      });
      return screen;
    }
  }
  return undefined;
}

function changeOf(letter: string | undefined): ScreenChange {
  if (letter === "A") return "added";
  return letter === "D" ? "removed" : "modified";
}

async function describeChanged(
  context: { repo: string; base: string; config: Config },
  file: string,
  letter: string,
): Promise<ChangedScreen> {
  const { repo, base, config } = context;
  const diff = await gitOutput(repo, [
    "diff",
    "-U0",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    `${base}...HEAD`,
    "--",
    file,
  ]);
  const lines = changedLines(diff);
  const screen = await readScreen({ repo, config }, ["HEAD", base], file);
  return {
    screen: file,
    title: screen?.title ?? null,
    change: changeOf(letter),
    lines: lines.slice(0, MAX_SUMMARY_LINES),
    truncated: lines.length > MAX_SUMMARY_LINES,
  };
}

async function findBehind(
  context: { repo: string; config: Config },
  changed: { screens: Set<string>; files: Map<string, string> },
): Promise<BehindScreen[]> {
  const { repo, config } = context;
  const listed = await gitOutput(repo, ["ls-files", "-z", "--", ...config.screens], true);
  const found: BehindScreen[] = [];
  for (const file of listed.split("\0").filter((name) => name !== "")) {
    if (changed.screens.has(file)) continue;
    const screen = await readScreen({ repo, config }, ["HEAD"], file);
    if (screen === undefined) continue;
    const files = screen.code.flatMap((entry) => repoRelativePath(entry.path) ?? []);
    const touched = [...new Set(files)].filter((name) => changed.files.has(name));
    if (touched.length > 0) found.push({ screen: file, title: screen.title, files: touched });
  }
  return found;
}

/**
 * ブランチ（HEAD）が base から分かれてから変えた画面と、実装だけ変えて画面を変えていないものをまとめる。
 * コミット済みの内容だけを見る。作業ツリーの未コミットの変更は含まない。
 */
export async function summarize(
  repo: string,
  config: Config,
  baseOption: string | undefined,
): Promise<SummaryResult> {
  const base = await resolveBase(repo, baseOption);
  if (base === undefined) {
    const named = baseOption === undefined ? "" : ` "${baseOption}"`;
    return { ok: false, error: `no base branch found${named}; pass one with --base <ref>` };
  }
  const range = `${base}...HEAD`;
  const screens = await changedFiles(repo, range, config.screens);
  const files = await changedFiles(repo, range, undefined);
  const changed: ChangedScreen[] = [];
  for (const [file, letter] of [...screens].sort(([a], [b]) => a.localeCompare(b))) {
    changed.push(await describeChanged({ repo, base, config }, file, letter));
  }
  const behind = await findBehind({ repo, config }, { screens: new Set(screens.keys()), files });
  return { ok: true, summary: { base, changed, behind } };
}
