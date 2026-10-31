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

## Code standards

`npm run check` runs the type check, the linter and the tests; CI runs the same.

- **TypeScript is used as intended.** No `any`, no `as` assertions, no `!`, no `@ts-ignore`. Narrow with checks instead; if a value comes from outside (JSON, the command line, a file), validate it where it enters. Do not silence a type rule to make an error go away.
- **One function, one meaning.** A function does one thing and its name says what. No boolean flags that switch behavior (split the function); no parameter doing double duty. At most three parameters, about 40 lines, and low branching (the linter enforces the numbers).
- **Expected failures are values, not exceptions.** Return a result for what the caller will branch on. Throw only for bugs and for things that must not be mistaken for success (a failed git call is never reported as "no problems").
- **Untrusted text is never trusted.** Paths from a screen file are checked to stay inside the repository in one place, and anything from a file is stripped of control characters before it is printed.
- **Comments say why**, not what. Names say what.
- **Dependencies point one way**, as in [docs/decisions/001-module-layout.md](docs/decisions/001-module-layout.md). A test checks this.
- A suppression comment needs a real reason. The only ones today are two control-character regexes, where matching control characters is the point.

## Tests

Staleness is decided from git history, so tests build a temporary git repository and replay a history. Cases are listed in [docs/staleness-cases.md](docs/staleness-cases.md); add a case there when you find a new one.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Do not open a public issue.
