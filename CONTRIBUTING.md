# Contributing to supercanvas

Thanks for helping build supercanvas.

supercanvas is pre-release software. Issues and design feedback are welcome now.
Code contributions follow an issue-first, maintainer-approved process.

## Contribution model

Every change intended for `main` starts with an issue, including maintainer,
documentation, dependency, refactor, test, CI, and release work:

1. Open the appropriate bug, feature, or maintenance issue and discuss its
   problem and scope.
2. Wait for a maintainer to add the `status:accepted` label.
3. Wait for a maintainer to assign the issue to you.
4. Create `<type>/<issue-number>-<short-description>` from current `main`.
5. Open one focused pull request containing `Closes #123` for that issue.

An accepted issue is approval of the agreed scope, not blanket approval of an
implementation. Do not begin implementation merely because an issue exists.
Pull requests for unaccepted issues, or from authors who are not assigned to the
linked issue, will be closed without code review.

Not every observation needs a new issue. Record work that remains inside the
accepted scope on the existing issue. If implementation reveals a separate
problem, improvement, or cleanup, open a new issue and keep it out of the
current branch and pull request.

Security work is coordinated privately under [SECURITY.md](SECURITY.md). Do not
open a public issue or pull request for an undisclosed vulnerability.

### Maintainer triage

Maintainers add `status:accepted` only after the problem, repository boundary,
and intended scope are clear enough to implement. Assignment identifies who is
authorized to open the pull request; the label alone is not an open invitation.
The `contribution-policy` check verifies both conditions from GitHub metadata.

## Before opening an issue

Search existing issues for the same problem or proposal. Remove secrets,
credentials, absolute private paths, and personal data from every report.

## Development

supercanvas is plain Node.js ES modules with no build step and no runtime
dependencies. Use the Node version in `.nvmrc` (the engine requires Node 20+).

Verify changes with:

```sh
node bin/supercanvas.mjs help
node bin/supercanvas.mjs update --all examples
npm pack --dry-run
```

`update --all examples` renders and verifies every example canvas package;
`npm pack --dry-run` confirms the published file list stays intact.

## Sign your commits (DCO)

Every commit must include a `Signed-off-by` trailer matching the commit author
or committer ([DCO](DCO)). Use `git commit -s`. The `DCO` check enforces this
on every pull request.
