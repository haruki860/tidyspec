# Tidyspec

Keep per-screen specs short, in Markdown, written by your coding agent. Preview them as a page, and catch the ones the code has left behind.

> **Status: early. Nothing is released yet.** `SPEC.md` is the design (in Japanese for now). The code is being built starting with staleness detection. Expect breaking changes.

## Idea

- The coding agent writes and updates one short Markdown file per screen, in the same commit as the code.
- The library never writes prose. It parses the Markdown, previews it, and checks it against git history and the schema.
- A human reviews the diff to see whether the agent changed anything it was not asked to.

Read [SPEC.md](SPEC.md) for the full design and [docs/staleness-cases.md](docs/staleness-cases.md) for how staleness is decided. [examples/](examples) shows what a screen file looks like.

## Development

Requires Node.js 22 or later.

```sh
npm ci
npm run typecheck
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Repository settings to apply on GitHub are in [docs/github-setup.md](docs/github-setup.md).

## License

[MIT](LICENSE)
