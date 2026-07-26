# Canvas Authoring Guide

The goal of this guide is that creating a Canvas in any project means writing only that Canvas's
source data — never rebuilding or copying the renderer, context router, runtime or feedback protocol.

## 1. One engine, many data packages

```text
supercanvas clone                       one shared engine
  render.mjs
  update.mjs
  context.mjs
  verify.mjs
  protocol.mjs
  library.mjs
  rules.mjs
  runtime/
  templates/minimal/

any project worktree
  .data/canvas/_shared/rules.json       rules shared by every local Canvas
  .data/canvas/<canvas-name>/           Canvas-specific source package only
    canvas.json
    library.json
    relations.json
    actions.json
    notes.json
    feedback.json
    frames/
    styles/
    design/                             optional
    dist/canvas.html                    generated output
```

Never copy Supercanvas JavaScript, runtime CSS or templates into a Canvas package. The shared engine
is built to read `--in <package>/canvas.json` regardless of where the manifest lives. Keep only
Frame source, relations, Actions, Notes, feedback and that Canvas's visual source in the package.

If the consuming project ignores `.data/` globally, you can build a Canvas while working on product
code without Canvas source or generated HTML leaking into commits. Whether a Canvas package becomes
tracked source in the product repository is each project's call.

## 2. Locate the shared engine

One supercanvas clone is shared as the engine.

```sh
export SUPERCANVAS_KIT=/path/to/supercanvas
```

Do not make a copy of the engine per worktree. Every project on the machine uses that single clone
by absolute path.

## 3. Create a data-only package

Pick the package location from the root of the project you are working in.

```sh
export SUPERCANVAS_PACKAGE="$PWD/.data/canvas/project-review"
mkdir -p "$PWD/.data/canvas"
cp -R "$SUPERCANVAS_KIT/templates/minimal" "$SUPERCANVAS_PACKAGE"
```

What gets copied is only the Canvas source skeleton; no shared runtime code is included. Replace all
of the following before the first render.

1. `canvas.id`, title and version in `canvas.json`
2. `canvasId` in every sidecar
3. `canvasVersion` in `feedback.json`
4. the first Frame's ID, source filename, title and summary
5. the Frame fragment and Canvas-specific styles
6. Library IDs, titles and definition data in `library.json`

Do not copy the common rules into each package. Create `.data/canvas/_shared/rules.json` once and
omit `sources.rules` from the manifest. The renderer and the context router read the sibling
`_shared` file automatically. Declare a package-local `rules.json` only in the exceptional case where
a package needs its own rules.

IDs must be globally unique within the package, and as a rule are not reused across other Canvases
either. Stable IDs stay the same even when coordinates, display order or titles change.

## 4. What belongs in Canvas data

| Source | Responsibility |
|---|---|
| `canvas.json` | Canvas metadata, Frame index, source routing, layout |
| `relations.json` | Groups, Connections and orthogonal port routes |
| `actions.json` | HTML Action anchors, triggers, outcome Frames |
| `notes.json` | behavior, policy, rationale, edge-case and content canon |
| `feedback.json` | portable review Comments and target revisions |
| `library.json` | Agent-readable foundation, layout, component and Story contracts |
| `../_shared/rules.json` | active/proposed rules and verification contracts applied to all Canvas work |
| `frames/*.html` | markup-only executable HTML state |
| `styles/*.css` | visual composition needed only by this Canvas |
| `design/*` | optional shared token/component source |
| `dist/canvas.html` | generated standalone output; never read or edited as source |

Do not copy the following into a Canvas package.

- `render.mjs`, `context.mjs`, `verify.mjs`, `protocol.mjs`, `library.mjs`, `rules.mjs`
- `runtime/board.js`, `runtime/canvas.css`, `runtime/template.html`
- implementations of pan/zoom, feedback import/export, the Frame picker or the Planning Note view

When shared behavior is broken, fix the supercanvas engine once. Only a specific Canvas's screens,
relations, policies or visual expression are fixed in the package data.

## 5. Update with the shared engine

In the consuming project, edit the package data and then run nothing but the shared engine's
`update.mjs`. Run it from a Canvas package folder to regenerate and verify just that package against
the latest runtime.

```sh
cd "$SUPERCANVAS_PACKAGE"
node "$SUPERCANVAS_KIT/update.mjs"
```

Run it without arguments from the worktree root to find `.data/canvas/*/canvas.json` and update every
local Canvas.

```sh
cd <current-worktree-root>
node "$SUPERCANVAS_KIT/update.mjs"
```

You can also name a specific package or a separate Canvas root.

```sh
node "$SUPERCANVAS_KIT/update.mjs" .data/canvas/project-review
node "$SUPERCANVAS_KIT/update.mjs" --all .data/canvas
```

The command renders each package's `dist/canvas.html` with the current shared engine and then runs
`verify.mjs`. It never changes Canvas source data on its own and never migrates the schema. If
verification fails it stops at that package and returns the error as is.

## 6. Render, inspect and verify separately

```sh
node "$SUPERCANVAS_KIT/render.mjs" \
  --in "$SUPERCANVAS_PACKAGE/canvas.json" \
  --out "$SUPERCANVAS_PACKAGE/dist/canvas.html"

node "$SUPERCANVAS_KIT/context.mjs" \
  --canvas "$SUPERCANVAS_PACKAGE/canvas.json" \
  --target canvas-replace-with-unique-id

node "$SUPERCANVAS_KIT/verify.mjs" "$SUPERCANVAS_PACKAGE"
```

`verify.mjs` does not depend on any particular Frame name. For an arbitrary Canvas package it checks
schema, global IDs, target revisions, Action references, the feedback round-trip, selective context
cost and the generated snapshot. It can verify a minimal package that has no Actions or Comments yet.

Most consumers use `update.mjs`. Run the commands above individually only to diagnose the renderer or
the verifier.

## 7. Agent editing workflow

Every task starts from a stable target ID.

```text
identify a feedback Comment ID or target ID
→ run context.mjs
→ check commonRules.active and its verification checks
→ for UI/UX work, look up the Library index or a stable component ID
→ read read.required first, and only that
→ read read.conditional only when the actual change needs it
→ edit the data/fragment/style source
→ update.mjs
→ review the interaction in dist/canvas.html
```

Even when hunting for a target across the whole Canvas, do not read the generated HTML. Run the
context router with the Canvas ID, check the Frame/Action index and byte metrics, then run it again
with the concrete target.

For UI/UX work, check the Canvas context's `libraryIndex` before writing Frame HTML. If a suitable
stable component/layout ID exists, run context again with that ID.

```sh
node "$SUPERCANVAS_KIT/context.mjs" \
  --canvas "$SUPERCANVAS_PACKAGE/canvas.json" \
  --target ui-button
```

The `definition` in the result is an implementation contract — props, states, slots, events, token
dependencies, accessibility and use/avoid criteria — not a specific React or CSS syntax. The Agent
implements that definition in the target project's technology and conventions, but never invents
variants or states that are not defined.

An Agent handed a feedback file resolves context for each Comment target and then works. For a
finished Comment it binds the new target hash and records `status: resolved`,
`resolution.summary`, `resolution.changes` and an Agent thread message. A Comment that needs a
product decision stays at `status: discussion` with a specific question left as an Agent thread
message. When saving the file, increment `feedbackRevision` once and re-run the render. Never clean
up review history by bumping the Canvas version or deleting all comments, and never drop or rewrite
entries in `archive` — that array is the record of comments already closed and reported. The Canvas
default view shows only `open` and `discussion` pins and hides `resolved` from the screen and the
header count; a comment listed in `archive` is filtered out of the review list entirely. The user's
next `Save feedback` is what moves a `resolved` comment from `comments` into `archive`, so the Agent
leaves resolved entries in `comments` with their resolution intact and lets the save rotate them.
If the user explicitly asks to empty the current review, run `Clear all comments`, save, and reflect
that feedback file's empty comments array in the canonical source.

When the user explicitly asks for a common rule in conversation, the Agent adds an `active` rule with
provenance and verification to `_shared/rules.json` and increments `rulesRevision` once. If the Agent
judges that comment feedback is reusable across several Frames or Canvases, it does not activate the
rule directly. It sets the Comment's `ruleProposal.status` to `proposed`, writes a concrete
statement, rationale, appliesTo and checks, and then asks for user approval. When the user saves
feedback approved in the `Common rules` view, the proposal becomes `approved`. On the next feedback
pass the Agent promotes it to a shared active rule and preserves the
`source: { "type": "feedback", "ref": "<comment-id>" }` provenance.

## 8. Frame, Action and Note rules

- Never put `<script>` or `<style>` in a Frame fragment.
- Open the UI Kit view from `UI Kit` in the Canvas header to see Library definitions and Story previews in the same output.
- Declare the Library entries a Frame uses as stable IDs in `libraryUses`.
- Mark reusable component roots in real markup with `data-ui="<component-id>"`. The renderer fails
  when `data-ui` and `libraryUses` disagree or the component is not registered.
- Native HTML scroll, hover and input run in Frame Interact.
- Turn a significant click result into a separate Frame and wire it up as an Action outcome.
- Put `data-action="action-id"` on the Action element.
- Connections start from a real Action's top/right/bottom/left port and use an orthogonal gutter route.
- Planning Notes appear as cards around the Frame in the Planning Note view, tied to items by numbered anchors.
- Comments and Notes keep separate canon and lifecycles.
- Frame feedback uses `anchor.kind: point | region`. A region's x/y/width/height are percentages
  relative to the Frame, and the Comment is still bound to the stable Frame ID and target revision.
- Never enable Frame Interact and the Planning Note view at the same time.
- Apply `commonRules.active` before working on any target and complete each rule's verification checks.
- A common rule the Agent inferred from a comment stays proposed until the user approves it.

For concrete schema examples, follow `README.md` at the repository root and
`examples/reading-list/`.

## 9. Ready-to-paste prompt for another session

Open a new Agent session and use the following prompt.

```text
Work in <current project worktree path>.

Use the shared Supercanvas engine at:
<supercanvas clone path>

The Canvas-specific source package is:
<current worktree path>/.data/canvas/<canvas-name>

Read the shared guide completely before acting:
<supercanvas clone path>/docs/authoring-guide.md

Do not recreate or copy renderer, context, runtime, feedback, Frame picker or Planning Note code.
Edit only the Canvas package data and its declared Frame/design sources unless the task explicitly
concerns the shared engine. Begin from a stable target ID and run the shared context.mjs first.
For UI/UX work, query the Library index before creating markup and reuse exact component contracts.
Apply every commonRules.active entry returned by context.mjs and run its verification checks.
Generalizable feedback must become a proposed ruleProposal first; never activate an inferred rule
without user approval.
Never edit dist/canvas.html as source. Run the shared update.mjs after changes.

Target: <stable-target-id>
Task: <requested change>
```

If the new session cannot read the guide or the engine path, stop and confirm the correct supercanvas
clone path first. Never build an ad-hoc runtime replacement inside the Canvas package.

## 10. Tracking boundary

A Canvas package is by default local review material for the project that uses it. From the moment
you want to include the package as that project's tracked canonical source, apply that repository's
review and branch workflow. Changes to the engine itself go through issues and PRs in this
supercanvas repository.
