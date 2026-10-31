import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 依存の向きを守らせる。構成は docs/decisions/001-module-layout.md。
 * 下の層は上の層を知らない: core ← repo ← checks ← setup ← cli
 */
const LAYERS = ["core", "repo", "checks", "setup", "cli"] as const;
type Layer = (typeof LAYERS)[number];

// 今はまだ平らな src/ なので、ファイル名から層を決める。ディレクトリに分けたら、ディレクトリから決める。
const LAYER_OF: Record<string, Layer> = {
  language: "core",
  messages: "core",
  parse: "core",
  config: "core",
  git: "repo",
  staleness: "repo",
  paths: "repo",
  hook: "checks",
  status: "checks",
  render: "checks",
  init: "setup",
  instructions: "setup",
  hookfile: "setup",
  cli: "cli",
  initCommand: "cli",
  prompter: "cli",
  bin: "cli",
  index: "cli",
};

// 構成を直すたびに縮める。新しい違反を足してはいけないし、直したら消さなければならない。
const KNOWN_LAYER_VIOLATIONS = [
  "config -> hook (core imports checks)",
  "messages -> staleness (core imports repo)",
];
const KNOWN_CYCLES = ["cli -> initCommand -> cli"];

const SRC = path.join(import.meta.dirname, "..", "src");
const IMPORT = /from "\.\/([A-Za-z]+)\.js"/g;

function modules(): string[] {
  return readdirSync(SRC)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => path.basename(file, ".ts"))
    .sort();
}

function importsOf(module: string): string[] {
  const source = readFileSync(path.join(SRC, `${module}.ts`), "utf8");
  const found = [...source.matchAll(IMPORT)].map((match) => match[1] ?? "");
  return [...new Set(found)].sort();
}

function graph(): Map<string, string[]> {
  return new Map(modules().map((module) => [module, importsOf(module)]));
}

function layerIndex(module: string): number {
  const layer = LAYER_OF[module];
  return layer === undefined ? -1 : LAYERS.indexOf(layer);
}

function layerViolations(): string[] {
  const found: string[] = [];
  for (const [module, imports] of graph()) {
    for (const imported of imports) {
      if (layerIndex(imported) > layerIndex(module)) {
        found.push(`${module} -> ${imported} (${LAYER_OF[module]} imports ${LAYER_OF[imported]})`);
      }
    }
  }
  return found.sort();
}

// 深さ優先で辿り、戻ってきた辺ごとに、始点から始まるように揃えた循環を一つ記録する。
function cycles(): string[] {
  const edges = graph();
  const found = new Set<string>();
  const walk = (module: string, trail: string[]): void => {
    for (const next of edges.get(module) ?? []) {
      const at = trail.indexOf(next);
      if (at !== -1) found.add([...trail.slice(at), next].join(" -> "));
      else walk(next, [...trail, next]);
    }
  };
  for (const module of edges.keys()) walk(module, [module]);
  return [...new Set([...found].map(normalizeCycle))].sort();
}

function normalizeCycle(cycle: string): string {
  const members = cycle.split(" -> ").slice(0, -1);
  const [first = ""] = [...members].sort();
  const from = members.indexOf(first);
  const rotated = [...members.slice(from), ...members.slice(0, from)];
  return [...rotated, first].join(" -> ");
}

describe("architecture", () => {
  it("every module is assigned to a layer", () => {
    const unassigned = modules().filter((module) => LAYER_OF[module] === undefined);
    expect(unassigned).toEqual([]);
  });

  it("lower layers do not import higher ones (only the known exceptions)", () => {
    expect(layerViolations()).toEqual(KNOWN_LAYER_VIOLATIONS);
  });

  it("has no import cycles (only the known ones)", () => {
    expect(cycles()).toEqual(KNOWN_CYCLES);
  });
});
