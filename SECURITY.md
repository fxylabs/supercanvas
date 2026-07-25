# Security Policy

## Supported versions

Security fixes target the latest published release and the latest commit on
`main`.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting flow:

https://github.com/fxylabs/supercanvas/security/advisories/new

Do not open a public issue for a vulnerability. Include:

- the affected version or commit;
- operating system and Node.js version;
- reproduction steps or a minimal proof of concept;
- expected and observed impact.

Never include real user data, API keys, or credentials. Maintainers will
acknowledge a report as soon as practical and coordinate disclosure after a fix
is available.

## Current security boundary

supercanvas is a local CLI that reads and writes canvas package files on the
user's machine. It is expected to:

- make no network requests at any point — the CLI, the render pipeline, and
  the generated canvas are fully offline;
- generate `dist/canvas.html` as a single self-contained static file with no
  external scripts, stylesheets, or remote resources;
- escape canvas metadata (titles, language, labels) when rendering; frame HTML
  sources are embedded as-is by design, so a canvas package is trusted input —
  only render packages you authored or reviewed;
- write only inside the target canvas package directory and the per-user
  registry file (`~/.supercanvas/registry.json`), never elsewhere on the
  filesystem.

Changes that affect these guarantees require an explicit security review in the
accepted issue and pull request. Undisclosed vulnerability fixes use the private
advisory flow above.
