import { type Config, DEFAULT_CONFIG } from "../config.js";
import { type CodeEntry, type Problem, parseScreen, severityOf } from "../core/parse.js";
import type { Schema } from "../core/schema.js";
import { git } from "../repo/git.js";
import { repoRelativePath } from "../repo/paths.js";
import { dataProblems, schemaFrom } from "./schema.js";

export type Violation =
  | { kind: "screen-problem"; screen: string; problem: Problem }
  | { kind: "screen-unreadable"; screen: string }
  | { kind: "code-file-missing"; screen: string; line: number; path: string }
  | { kind: "spec-not-updated"; file: string; screens: string[] };

export interface HookReport {
  ok: boolean;
  violations: Violation[];
  warnings: { screen: string; problem: Problem }[];
  /** 変わった実装ファイルのうち、どの画面の「コード」にも載っていないもの */
  unregistered: string[];
}

const STAGED = ["diff", "--cached", "--name-only", "-z", "--no-renames"];

type Warning = HookReport["warnings"][number];

/** 一つの画面を検査した結果。 */
interface ScreenInspection {
  /** この画面の「コード」が指す、repo 内のファイル */
  listed: string[];
  violations: Violation[];
  warnings: Warning[];
}

function listedFiles(code: CodeEntry[]): string[] {
  return code.flatMap((entry) => repoRelativePath(entry.path) ?? []);
}

async function missingCodeFiles(
  repo: string,
  screen: string,
  code: CodeEntry[],
): Promise<Violation[]> {
  const found: Violation[] = [];
  for (const entry of code) {
    if (await isIndexed(repo, entry)) continue;
    found.push({ kind: "code-file-missing", screen, line: entry.line, path: entry.path });
  }
  return found;
}

async function inspectScreen(
  repo: string,
  screen: string,
  context: { config: Config; changed: Set<string>; schema: Schema | undefined },
): Promise<ScreenInspection> {
  const { config, changed, schema } = context;
  const source = await readIndexed(repo, screen);
  if (source === undefined) {
    const violations: Violation[] = changed.has(screen)
      ? [{ kind: "screen-unreadable", screen }]
      : [];
    return { listed: [], violations, warnings: [] };
  }
  const { screen: parsed, problems } = parseScreen(source, {
    maxLineLength: config.maxLineLength,
    language: config.language,
  });
  const listed = listedFiles(parsed.code);
  // 触っていない画面の崩れで、関係ないコミットを止めない。
  if (!changed.has(screen)) return { listed, violations: [], warnings: [] };

  const errors = [...problems, ...dataProblems(parsed, schema)].filter(
    (problem) => severityOf(problem) === "error",
  );
  const violations: Violation[] = [
    ...errors.map((problem): Violation => ({ kind: "screen-problem", screen, problem })),
    ...(await missingCodeFiles(repo, screen, parsed.code)),
  ];
  const warnings = problems
    .filter((problem) => severityOf(problem) === "warning")
    .map((problem) => ({ screen, problem }));
  return { listed, violations, warnings };
}

/** 実装ファイルを変えたのに、それを載せている画面がどれも変わっていないものを見つける。 */
function specsNotUpdated(
  changed: Set<string>,
  screenFiles: Set<string>,
  listedBy: Map<string, string[]>,
): Violation[] {
  const found: Violation[] = [];
  for (const file of changed) {
    if (screenFiles.has(file)) continue;
    const screens = listedBy.get(file) ?? [];
    // 載せている画面のうち、一つでも変わっていればよい。
    if (screens.length > 0 && !screens.some((screen) => changed.has(screen))) {
      found.push({ kind: "spec-not-updated", file, screens });
    }
  }
  return found;
}

/** 変わった実装ファイルのうち、どの画面にも載っていないもの。 */
async function unregisteredFiles(
  repo: string,
  config: Config,
  known: { screenFiles: Set<string>; listedBy: Map<string, string[]> },
): Promise<string[]> {
  if (config.implementation.length === 0) return [];
  const implementation = await listGlobbed(repo, [...STAGED, "--", ...config.implementation]);
  return implementation.filter((file) => !known.screenFiles.has(file) && !known.listedBy.has(file));
}

/**
 * これからコミットされる内容（インデックス）を検査する。作業ツリーは見ない。
 * 文章の正しさは見ず、形と、コードの行の参照、実装を変えたのに仕様が動いていないことだけを見る。
 */
export async function checkCommit(
  repo: string,
  config: Config = DEFAULT_CONFIG,
): Promise<HookReport> {
  const changed = new Set(await listPaths(repo, STAGED));
  const screenList = await listGlobbed(repo, ["ls-files", "-z", "--", ...config.screens]);
  const screenFiles = new Set(screenList);

  const schema = await indexedSchema(repo, config);
  const violations: Violation[] = [];
  const warnings: Warning[] = [];
  const listedBy = new Map<string, string[]>();
  for (const screen of screenList) {
    const inspection = await inspectScreen(repo, screen, { config, changed, schema });
    violations.push(...inspection.violations);
    warnings.push(...inspection.warnings);
    for (const file of inspection.listed)
      listedBy.set(file, [...(listedBy.get(file) ?? []), screen]);
  }
  violations.push(...specsNotUpdated(changed, screenFiles, listedBy));

  const unregistered = await unregisteredFiles(repo, config, { screenFiles, listedBy });
  return { ok: violations.length === 0, violations, warnings, unregistered };
}

/** コミットされる内容（インデックス）にある SQL からスキーマを作る。画面と同じ時点を見るため。 */
async function indexedSchema(repo: string, config: Config): Promise<Schema | undefined> {
  if (config.schema.length === 0) return undefined;
  const files = await listGlobbed(repo, ["ls-files", "-z", "--", ...config.schema]);
  return schemaFrom([...new Set(files)].sort(), (file) => readIndexed(repo, file));
}

// git が失敗したのに「変更なし」として通すと、検査したことにならない。失敗は呼び出し側に伝える。
async function listPaths(repo: string, args: string[]): Promise<string[]> {
  const result = await git(repo, args);
  return pathsOf(args, result);
}

/** 設定の glob（`**` など）を pathspec として展開させる。パスをそのまま渡すときは listPaths。 */
async function listGlobbed(repo: string, args: string[]): Promise<string[]> {
  const result = await git(repo, args, { globPathspecs: true });
  return pathsOf(args, result);
}

function pathsOf(args: string[], result: { code: number; stdout: string }): string[] {
  if (result.code !== 0) throw new Error(`git ${args[0] ?? ""} failed (exit ${result.code})`);
  return result.stdout.split("\0").filter((name) => name !== "");
}

// ファイル名を ref の記法（:path）に混ぜないよう、いったん blob のハッシュを引いてから読む。
async function readIndexed(repo: string, file: string): Promise<string | undefined> {
  const entry = await git(repo, ["ls-files", "-s", "-z", "--", file]);
  const hash = /^\d+ ([0-9a-f]+) 0\t/.exec(entry.stdout)?.[1];
  if (hash === undefined) return undefined;
  const blob = await git(repo, ["cat-file", "blob", hash]);
  return blob.code === 0 ? blob.stdout : undefined;
}

async function isIndexed(repo: string, entry: CodeEntry): Promise<boolean> {
  const file = repoRelativePath(entry.path);
  if (file === undefined) return false;
  return (await listPaths(repo, ["ls-files", "-z", "--", file])).includes(file);
}
