# Tidyspec

Keep per-screen specs short, in Markdown, written by your coding agent. Preview them as a page, and catch the ones the code has left behind.

> **Status: early. Nothing is released yet.** `SPEC.md` is the design (in Japanese for now). The code is being built starting with staleness detection. Expect breaking changes.

## Idea

- The coding agent writes and updates one short Markdown file per screen, in the same commit as the code.
- tidyspec never writes prose. It parses the Markdown, previews it, and checks it against git history and the schema.
- A human reviews the diff to see whether the agent changed anything it was not asked to.

Read [SPEC.md](SPEC.md) for the full design and [docs/staleness-cases.md](docs/staleness-cases.md) for how staleness is decided. [examples/](examples) shows what a screen file looks like.

## Usage (not published yet)

```sh
tidyspec init     # asks a few questions: language, screens directory, hook, agent instructions
tidyspec check    # inspect what is staged; for a commit hook
tidyspec status   # are any screens behind the code they point to?
tidyspec preview  # read the screens in the browser (a local, read-only page)
```

`preview` serves a read-only page on `127.0.0.1` only (default port 4321, `--port`), rereads the files on every request, and stops with Ctrl-C. It shows each screen's four sections and marks code that is newer than the spec. Everything it shows is escaped, and it only opens files that the status check lists as screens.

The instructions go in `AGENTS.md`, which Claude Code, Codex and Cursor all read. An older Claude Code that only reads `CLAUDE.md` needs the line `@AGENTS.md` added to it.

`init` asks questions only in a terminal; coding agents and CI pass `--yes` (with `--lang`, `--screens-dir`, `--no-hook`, `--no-instructions`). `check` and `status` take `--json`. Exit codes: 0 ok, 1 problems found, 2 usage, config or git failure. Settings live in an optional `tidyspec.json` (`screens`, `implementation`, `maxLineLength`, `language`). `language` is `en` (default) or `ja`; it sets the section headings (`Spec / Design / Code / Data` or `仕様 / 設計 / コード / データ`) and the language of the findings. See [examples/shop-en](examples/shop-en) and [examples/shop](examples/shop) (Japanese).

## Development

Requires Node.js 22 or later.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Repository settings to apply on GitHub are in [docs/github-setup.md](docs/github-setup.md).

## License

[MIT](LICENSE)
