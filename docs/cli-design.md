# Supercanvas CLI design

A global CLI on top of the central engine creates, manages, updates and views multiple canvas
packages. What is settled is "global CLI + packages as data in each project repo + machine-level
registry"; the detailed design below is still a proposal. Items that get settled during
implementation are folded back into this document.

## Principles

- Never copy engine code. The CLI is the only entry point and a canvas package holds data only.
- Reuse the existing `render.mjs` / `verify.mjs` / `context.mjs` / `update.mjs`. The CLI adds only
  subcommand routing and a package resolution layer.
- `canvas.json` at the package root is the package marker. Do not introduce a separate marker file.

## Command surface (proposed)

```text
supercanvas new <dir> [--title t] [--template minimal]   scaffold a package + register it
supercanvas add [path] [--slug s]                        register an existing package
supercanvas update [target]                              render + verify (current update.mjs)
supercanvas render [target]                              render only
supercanvas verify [target]                              verify only
supercanvas view [target] [--port n] [--no-open]         serve the canvas so Save feedback writes feedback.json
supercanvas list                                         registered canvases with schemaVersion and last render status
supercanvas remove <slug>                                remove from the registry (package files stay)
supercanvas feedback [target] [--json] [--status s]      print the comments waiting for the agent
supercanvas feedback --wait [--timeout s] [target]       block until the reviewer leaves work, then print it
supercanvas resolve <comment-id ...> --summary <text>    close comments with the change that answered them
supercanvas discuss <comment-id> --message <text>        ask the reviewer a question on a comment
supercanvas context --target <id> [target]               resolve the minimum source for an agent (current context.mjs)
supercanvas migrate [target]                             step schemaVersion upgrades
```

`[target]` resolution rules: with no argument, walk up from cwd looking for `canvas.json` (the way git
does). A path is used as is; anything else is looked up as a registry slug.

## Registry (proposed)

- Location: `~/.supercanvas/registry.json` — a machine-local mapping of `slug → { path, registered at }`.
- Paths differ per machine, so the registry is not version controlled. The packages themselves are
  version controlled by each project repo.
- Do not build it on top of the self workspace store. Supercanvas must work standalone in
  environments without self.

## Distribution (proposed)

- Add `package.json` and `bin/supercanvas.mjs` (the subcommand router) to this repo.
- Install with `git clone` then `npm link`, or `npm install -g` from the git URL. The mjs files run
  directly, with no separate build.

## schemaVersion compatibility (prerequisite)

Once the engine is global, "I upgraded the engine and my old canvas won't open" shows up immediately.
Hence:

- Every CLI command checks the package's `schemaVersion` first and, if it is outside the engine's
  supported range, refuses to render and points at `migrate`. Explicit refusal beats silent partial
  failure.
- Implement `migrate` as per-version sequential converters (v2→v3→…) and run `verify` automatically
  after converting.
- Current implementation: apply `migrateManifest`/`migrateSidecar` (v1→v2) from `protocol.mjs`
  permanently to the manifest and the `sources` sidecar files, then run `update` (render+verify). A
  version newer than the engine is refused explicitly across update/render/verify/context/view/add;
  v1 warns and proceeds.
- Runs in parallel with roadmap track A (schema versioning and migration strategy).

## Implementation steps

1. `package.json` + the `bin/supercanvas.mjs` router — wrap the existing scripts so `update`/`render`/
   `verify`/`context` work through the CLI.
2. The registry and `new`/`add`/`list`/`view` — scaffolding copies `templates/minimal`.
3. The schemaVersion gate and the `migrate` skeleton.

## Open questions

- Whether `view` simply opening a file is enough, or a watch mode that serves over a local server and
  detects re-renders is needed.
- Slug namespacing: whether to go with a `project/canvas` form when a project has several canvases.
