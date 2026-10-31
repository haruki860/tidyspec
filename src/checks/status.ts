import path from "node:path";
import type { Config } from "../config.js";
import { type ParsedScreen, type Problem, parseScreen } from "../core/parse.js";
import type { Schema } from "../core/schema.js";
import { listProjectFiles, readRegularFile } from "../repo/files.js";
import { checkStaleness, type ScreenReport } from "../repo/staleness.js";
import { dataProblems, loadSchema } from "./schema.js";

export interface ScreenStatusReport {
  screen: string;
  problems: Problem[];
  staleness: ScreenReport;
}

/** 画面の検査結果に、読み取った中身を添えたもの。表示（preview）が使う。 */
export interface ScreenInspection extends ScreenStatusReport {
  parsed: ParsedScreen;
}

/** 全画面の検査結果と、ER 図の元になるスキーマ（SQL が見つからなければ undefined）。 */
export interface Inspection {
  screens: ScreenInspection[];
  schema: Schema | undefined;
}

/** 作業ツリーにある全ての画面について、形の問題と古さを調べる。git の中でだけ動く。 */
export async function checkAllScreens(repo: string, config: Config): Promise<ScreenStatusReport[]> {
  const { screens } = await inspectProject(repo, config);
  return screens.map(({ screen, problems, staleness }) => ({ screen, problems, staleness }));
}

async function inspectScreen(
  repo: string,
  screen: string,
  context: { config: Config; schema: Schema | undefined },
): Promise<ScreenInspection | undefined> {
  const source = await readRegularFile(path.join(repo, screen));
  if (source === undefined) return undefined;
  const { config, schema } = context;
  const { screen: parsed, problems } = parseScreen(source, {
    maxLineLength: config.maxLineLength,
    language: config.language,
  });
  const staleness = await checkStaleness({
    repo,
    screen,
    code: parsed.code.map((entry) => entry.path),
  });
  return { screen, parsed, problems: [...problems, ...dataProblems(parsed, schema)], staleness };
}

/** checkAllScreens と同じ検査をして、読み取った中身とスキーマも返す。 */
export async function inspectProject(repo: string, config: Config): Promise<Inspection> {
  const schema = await loadSchema(repo, config);
  const screens: ScreenInspection[] = [];
  // 追跡中のものと、まだ追跡していない新しい画面の両方。
  for (const screen of await listProjectFiles(repo, config.screens)) {
    const inspected = await inspectScreen(repo, screen, { config, schema });
    if (inspected) screens.push(inspected);
  }
  return { screens, schema };
}
