# GitHub settings checklist

Applied on 2026-10-31 (the checked items). Do these after the repository is created and public. Branch protection and rulesets are available on public repositories without a paid plan.

## Settings → General

- [x] Pull Requests: allow squash merging only. Default commit message: "Pull request title".
- [x] Automatically delete head branches

## Rules (Settings → Rules → Rulesets) for `main`

Ruleset `protect main`. No bypass actors: the owner also goes through a pull request. Verified by a rejected direct push.

- [x] Require a pull request before merging
- [x] Require status checks to pass: `check (22)`, `check (24)`
- [x] Block force pushes
- [x] Restrict deletions
- [x] Require linear history

## Settings → Code security

- [x] Private vulnerability reporting: enable (SECURITY.md depends on it)
- [x] Dependabot alerts and security updates: enable
- [x] Secret scanning and push protection: enable

## Account

- [ ] Two-factor authentication on the owner account

## Before the first release

- [ ] Remove `"private": true` from `package.json`
- [ ] Publish from GitHub Actions with npm provenance, not from a laptop
- [ ] Decide on changesets and a CHANGELOG
- [ ] Add a CODE_OF_CONDUCT with a contact the maintainer chooses
