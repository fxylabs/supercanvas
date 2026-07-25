# Supercanvas Roadmap

Improvement plan for hardening a canvas foundation that can be reused across many projects.
Each track can proceed independently.

## Invariants

The following conditions hold throughout every improvement.

1. Canvas, Frame, Group, Connection, Action, Note, Comment and Library targets all carry globally
   non-colliding stable IDs.
2. IDs survive changes to display order and coordinates, and a deleted ID is never reused for
   another object.
3. Generated HTML is output-only. Every change starts from source or from the renderer/runtime.
4. Frame fragments contain no `<script>` and no `<style>`.
5. A Frame declares the token/component source it uses via `uses` in the manifest.
6. Comment identity binds to a stable target and revision, not to coordinates. Point/region geometry
   is an anchor expression inside the Frame and never replaces target identity.
7. Connections and Notes can be review targets just like Frames.
8. JSON feedback is the portable canon and takes precedence over localStorage. localStorage holds
   unsubmitted drafts.
9. Connections start from a top/right/bottom/left port of an Action or a target and use 90°
   orthogonal routes with gutter lanes.
10. The Design Library definition is the canonical source. The Canvas UI Kit is a preview of that
    same definition, and generating framework-specific code is an optional adapter.
11. Keep the Comment workflow status `open | discussion | resolved` separate from the revision state
    `current | outdated | unbound`.
12. A common rule the user stated explicitly can be recorded as active. A rule the Agent inferred is
    proposed and is not promoted to active before the user approves it.

## A. Core model and renderer

- Version the schema explicitly and settle on a migration strategy.
- Strengthen stable ID generation, referential integrity and cycle/duplicate/error reporting.
- Review a boundary that allows loading and rendering frame source selectively even on large canvases.
- Add deterministic output plus source hash/revision metadata.
- Decide whether to split the renderer, context router and feedback importer/exporter into independent modules.
- Make invalid source surface as a per-target error instead of breaking the entire canvas.

## B. Interaction and review

- Tidy up pan, zoom, fit, minimap, keyboard navigation and focus movement.
- Allow selecting and commenting on Connections, Groups and Notes as clearly as on Frames.
- Verify the comment create/edit/resolve/reopen/delete flow and its visible status.
- In Board Review the Canvas owns pan/zoom; in Frame Interact the HTML Frame owns
  scroll/hover/click/keyboard input. Escape returns focus to the board.
- Define the outdated/review-needed state for when the target revision a comment points at has changed.
- Make JSON import/export preserve IDs, targets, revisions, author placeholders and status.
- Check accessibility, reduced motion, high contrast, 200% zoom and long text.

## C. Design system

- Separate semantic tokens from component tokens and leave room for light/dark/high-contrast extensions.
- Separate the style namespace of product UI inside a Frame from the Canvas's own chrome.
- Build a state table for Frame, Group, Connector, Note, Pin, Toolbar, Inspector and the Comment modal.
- Make selected, hovered, commented, resolved, changed, invalid and blocked states not depend on color alone.
- Manage icons in an asset registry with name, purpose, size and stroke rules.
- Manage Foundations, Layouts, Components and Stories as stable targets in `library.json`.
- Provide search, state previews and the exact JSON definition in the Canvas header's UI Kit view.
- Prioritize platform-neutral UI/UX contracts over implementation artifacts such as React or CSS.

## D. Token efficiency

- Every task starts from a stable target ID.
- Read only `required` from the context result first; read `conditional` only when the actual change needs it.
- Frame summaries and relation metadata alone must be enough to identify a target.
- A shared design change must be done once in the token/component source.
- Measure the file count and byte count returned by the context router to catch regressions.
- Keep generated HTML, bundled runtime and unrelated Frame source out of the default Agent context.

## Verification contract

Minimum verification after changing the engine:

```sh
node --check render.mjs
node --check context.mjs
node --check runtime/board.js
node update.mjs examples/reading-list
node context.mjs \
  --canvas examples/reading-list/canvas.json \
  --target frame-reading-home
```

Also confirm the following by hand.

- No unresolved template placeholders remain.
- No duplicate or dangling IDs and relation targets.
- Generated output is never edited back as source.
- Targets and statuses survive a comment JSON export/import round-trip.
- Representative interactions can be performed with both mouse and keyboard.
