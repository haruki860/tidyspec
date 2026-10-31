# Contributing

Tidyspec is early. Before a large change, open an issue so we can agree on the direction. [SPEC.md](SPEC.md) is the source of truth for behavior: if code and SPEC disagree, change one of them in the same PR and say why.

## Setup

```sh
npm ci
npm run typecheck
npm test
```

Node.js 22 or later.

## Pull requests

- `main` is protected. Open a PR from a branch; do not push to `main`.
- Keep a PR to one change. Include tests for behavior you add or fix.
- CI (typecheck and tests) must pass.
- PRs are squash-merged, so the PR title becomes the commit message. Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.
- If you change behavior described in `SPEC.md` or `docs/`, update them in the same PR.

## Tests

Staleness is decided from git history, so tests build a temporary git repository and replay a history. Cases are listed in [docs/staleness-cases.md](docs/staleness-cases.md); add a case there when you find a new one.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do not open a public issue.
