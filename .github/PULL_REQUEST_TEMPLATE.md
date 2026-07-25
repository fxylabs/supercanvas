## Accepted issue

<!-- Required: the issue must have status:accepted and you must be an assignee. -->

Closes #

- [ ] A maintainer added `status:accepted` to the issue
- [ ] A maintainer assigned the issue to me
- [ ] My branch is named `<type>/<issue-number>-<short-description>`
- [ ] Every commit includes my DCO `Signed-off-by` trailer

## Problem

<!-- What user or maintainer problem does this solve? -->

## Result

<!-- Describe the user-visible and technical outcome. -->

## Verification

- [ ] `node bin/supercanvas.mjs help`
- [ ] `node bin/supercanvas.mjs update --all examples`
- [ ] `npm pack --dry-run` (published file list unchanged or intentionally updated)
- [ ] Added or updated example/verify coverage where appropriate

## Risk review

- Canvas package schema or migration impact: none / describe
- Registry (`~/.supercanvas`) impact: none / describe
- Security-boundary impact (offline guarantee, self-contained output): none / describe
- Platforms exercised: describe
- Visual change: none / screenshots or recording attached
