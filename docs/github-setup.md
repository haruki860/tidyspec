# GitHub settings checklist

Do these after the repository is created and public. Branch protection and rulesets are available on public repositories without a paid plan.

## Settings → General

- [ ] Pull Requests: allow squash merging only. Default commit message: "Pull request title".
- [ ] Automatically delete head branches

## Rules (Settings → Rules → Rulesets) for `main`

- [ ] Require a pull request before merging
- [ ] Require status checks to pass: `check (22)`, `check (24)`
- [ ] Block force pushes
- [ ] Restrict deletions
- [ ] Require linear history

## Settings → Code security

- [ ] Private vulnerability reporting: enable (SECURITY.md depends on it)
- [ ] Dependabot alerts and security updates: enable
- [ ] Secret scanning and push protection: enable

## Account

- [ ] Two-factor authentication on the owner account

## Before the first release

- [ ] Remove `"private": true` from `package.json`
- [ ] Publish from GitHub Actions with npm provenance, not from a laptop
- [ ] Decide on changesets and a CHANGELOG
- [ ] Add a CODE_OF_CONDUCT with a contact the maintainer chooses
