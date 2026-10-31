# 001: Module layout, and how new document kinds plug in

Date: 2026-10-31 / Status: proposed

## Problem

`src/` is flat (17 files, ~1500 lines) and grew one feature at a time. Found on review:

- `config` imports its own type from `hook` (dependency points the wrong way); `cli` and `initCommand` import each other (type-only cycle).
- `index.ts` re-exports everything, so internals (`git()`, `HOOK_SCRIPT`) would become public API on first release.
- "Is this path inside the repository?" is decided in two places (`staleness.ts`, `hook.ts`) with different code. It guards untrusted input, so a fix in one place and not the other is a hole.

The preview will document more than screens: the directory structure, components, and an ER diagram from the schema. New kinds must plug in without rewriting the checks.

Constraints: one maintainer, nothing released (breaking changes are free), 173 tests as a safety net. The checks that tie a document to code (staleness, commit gate) are the product's core.

## What the checks need from a document

Only three things: its file, the repository paths it claims to describe (`references`), and its parse problems. A screen already fits (its Code lines). A structure document would reference directories; an ER view references tables.

## Options considered

**A. Flat; copy the screen modules for each new kind.** No abstraction, fastest for the second kind. But staleness, commit check and status get duplicated per kind, and every fix is made N times. This already went wrong once (the path check). Cost and risk grow with each kind.

**B. A small seam.** Per-kind parsers produce a `Document { kind, file, references, problems }`; staleness, commit check and status work on `Document`s; the preview renders each kind with its own view. Layers point one way: `core` (pure) ← `repo` (git and files) ← `checks` ← `setup`, `cli`. Screens stay the only kind for now. Checks are written once and a new kind is a parser plus a view. The cost is one abstraction before a second kind exists; if a kind needs different checks (a directory is stale when any file under it changed) the seam may have to bend.

**C. A public plugin API for third-party kinds.** Rejected: no users, a frozen API to maintain, and speculative.

## Decision (recommended: B)

Keep the seam as small as the three needs above. No registry or plugin loading; kinds are listed in one place in code.

```
src/
  core/    language, messages, screen parser          (pure, no I/O)
  repo/    git, paths, staleness                      (the only place that touches git/files for checks)
  checks/  commit check, status, render
  setup/   init, instructions, hook file
  cli/     cli, commands, prompter, bin
  config.ts
  index.ts public API, listed by name
```

- `repo/paths` is the single decision on "inside the repository?".
- The dependency direction is enforced by a test (and lint), not by convention.
- Public API (proposed): `parseScreen`, `checkStaleness`, `checkCommit`, `checkAllScreens`, `loadConfig` and their types. Open question: should this be a library at all, or CLI only?

## Consequences

- One place for the path check; one place to add a kind; the inverted dependency and the cycle go away and stay away.
- A series of small, behavior-preserving PRs that touch every import (noisy blame).
- The seam is a guess until the second kind exists. How a directory reference is checked is deliberately not decided here.

## Counterargument

Rule of three: abstracting before the second use is a guess, so stay flat and extract later. Against it: the duplication has already cost us once, the seam is three fields, and moving files now (pre-release, 173 tests) is far cheaper than after publishing.

## CS notes

- Boundaries: the repo-path check is a trust boundary, so it needs a single source of truth.
- Staleness stays O(references): one `git log` per referenced path, for files or directories alike.
