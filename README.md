# Supercanvas

A local design-artifact canvas that Agents build and people review. HTML Frames are not static
images — they really run with scroll, hover, click and keyboard. When a person leaves feedback on a
stable target ID, the Agent edits only the minimum source for that target instead of reading the
whole canvas. That is the review loop this engine provides.

```text
Agent renders a visual artifact
→ person comments on a stable target
→ context router returns the minimum relevant source
→ Agent edits only that target and its declared dependencies
→ render, compare and review again
```

Core parts:

- `render.mjs` — renders a data package into a standalone HTML canvas
- `context.mjs` — selective context router that resolves a target ID into the minimum set of source files
- `verify.mjs` — verifies schema, ID integrity, feedback round-trip and context cost
- `update.mjs` — renders and verifies a package in one run
- `runtime/` — pan/zoom board, Frame interact, feedback, UI Kit, rules viewer
- `templates/minimal/` — minimal skeleton for a new Canvas package

## Quickstart

```sh
git clone https://github.com/fxylabs/supercanvas.git
cd supercanvas
npm link                      # install the global supercanvas command
supercanvas update examples/reading-list
supercanvas view examples/reading-list
```

Scaffold a new package with `supercanvas new <dir>`, and register an existing package in the machine
registry (`~/.supercanvas/registry.json`) with `add` so every later command can take a slug instead
of a path. Run `supercanvas help` for the full command list; see `docs/cli-design.md` for the design.

The output is standalone HTML with CSS, runtime and the JSON snapshot inlined, so it opens over
`file://`. Generated output is not Agent input.

Follow `docs/authoring-guide.md` to create a new Canvas package. Write only the data package — never
copy the engine code.

## Agent editing boundary

By default an Agent reads and edits nothing but the minimum source returned by the target router.

1. Start from a comment ID in `feedback.json` or a stable target ID.
2. Resolve the required source paths with `context.mjs`.
3. Apply `commonRules.active` from every context result first, and include its verification checks in your definition of done.
4. For UI/UX work, check the Canvas target's `libraryIndex` and look up existing Library IDs first.
5. For Frame work, read only that `frames/<frame-id>.html`.
6. For Relation or Note work, read only `relations.json` or `notes.json` respectively.
7. Read token/component source only when the change is a global visual one.

`runtime/` and `render.mjs` are canvas infrastructure. You do not need to read them to design a
frame or change a policy. The generated `canvas.html` is a review artifact too, not source.

## Thin manifest

```json
{
  "schemaVersion": 2,
  "canvas": {
    "id": "canvas-unique-id",
    "title": "Canvas title",
    "version": "v1",
    "language": "en"
  },
  "sources": {
    "tokens": "design/tokens.json",
    "library": "library.json",
    "rules": "rules.json",
    "relations": "relations.json",
    "actions": "actions.json",
    "notes": "notes.json",
    "feedback": "feedback.json"
  },
  "styles": ["design/components.css", "styles/canvas.css"],
  "frames": [
    {
      "id": "frame-unique-id",
      "title": "Frame title",
      "summary": "Enough routing context without opening frame markup",
      "uses": ["design/tokens.json", "design/components.css"],
      "libraryUses": ["ui-button", "layout-stack"],
      "source": "frames/frame-unique-id.html",
      "width": 1280,
      "height": 800,
      "x": 80,
      "y": 80
    }
  ]
}
```

Frame ID rules:

- unique within the canvas
- starts with a lowercase letter
- lowercase letters, digits and hyphens only
- 3–64 characters
- stable anchor for comments, connections, tabs and exported feedback

Beyond Frames, Canvas, Group, Connection, Note and Comment as well as
Library/Foundations/Layouts/Components/Stories all carry unique stable IDs in the same format. The
renderer validates every reference in `relations.json`, `notes.json` and `feedback.json` together
with its target type.

Schema v2 adds `action-*` targets, `actions.json` and deterministic revision metadata. The renderer
and the context router migrate a v1 package to the v2 shape in memory when reading it, but never
overwrite the source automatically. v1 read compatibility is kept until the next major schema.

## Design Library inside Canvas

`library.json` is the canonical definition data read both by the Storybook-style UI Kit inside the
Canvas and by Agent context. React components or CSS files are not required source. The Agent reads
props, states, slots, events, token dependencies, accessibility and usage guidance, then builds an
implementation that fits the target project.

```json
{
  "id": "ui-button",
  "name": "Button",
  "description": "Semantic button that runs an explicit user action.",
  "contract": {
    "element": "button",
    "className": "sc-button",
    "props": {
      "variant": {
        "type": "enum",
        "values": ["primary", "secondary", "danger"],
        "default": "primary",
        "description": "Importance and risk of the action"
      }
    },
    "slots": ["default", "leadingIcon"],
    "events": ["click"],
    "states": ["default", "hover", "focus-visible", "disabled"],
    "tokens": ["color.accent", "radius.md"]
  },
  "accessibility": ["Accessible name required", "Keep the keyboard focus indicator visible"],
  "guidance": {
    "use": ["Verb-phrase actions"],
    "avoid": ["Rendering a navigation link as a button"]
  },
  "stories": [
    { "id": "story-button-primary", "title": "Primary", "props": { "variant": "primary" } }
  ]
}
```

The `UI Kit` view in the Canvas header searches foundations, layouts and components, runs Stories,
and shows and copies the exact JSON definition of each entry. A Frame declares its Library
dependencies with `libraryUses` in the manifest and marks each real component root with `data-ui`.

```html
<button class="sc-button" data-ui="ui-button" type="button">New project</button>
```

The renderer checks that every `data-ui` names a registered component and that it is also declared
in the Frame's `libraryUses`. `context.mjs --target ui-button` returns the exact component
definition, the Frames that use it and optional token/source paths instead of the whole generated
HTML.

## Common Rules inside Canvas

Separately from the UI Kit, `rules.json` is the rule contract that constrains the Agent's Canvas
authoring behavior. To avoid duplicating it in every package, put a shared file at the Canvas
collection root.

```text
canvas-root/
├── _shared/rules.json
├── product-flow/
└── onboarding-review/
```

When the manifest has no `sources.rules`, the renderer and the context router automatically look up
`../_shared/rules.json`. Declare `sources.rules: "rules.json"` only when a package needs its own
rules.

```json
{
  "schemaVersion": 2,
  "rulesRevision": 1,
  "scope": "workspace",
  "rules": [
    {
      "id": "rule-frame-input-ownership",
      "title": "Separate Canvas and Frame input ownership",
      "status": "active",
      "priority": "must",
      "category": "interaction",
      "statement": "In board and comment mode the Canvas owns pan/zoom.",
      "rationale": "Prevents Frame interaction from fighting Canvas navigation.",
      "appliesTo": ["canvas", "frame"],
      "source": { "type": "user-instruction", "ref": "input-modes" },
      "verification": {
        "type": "agent-checklist",
        "checks": ["In comment mode, a wheel event over a Frame pans the Canvas."]
      }
    }
  ]
}
```

`status` is `active | proposed | deprecated` and `priority` is `must | should`. When the user asks
for a common rule explicitly, the Agent records it as an active rule. A rule the Agent generalized
from a comment is proposed as `ruleProposal.status: proposed` and is never promoted to active before
the user approves it. The `Common rules` view in the Canvas header lets you search and review active
rules, candidates awaiting approval, provenance and verification.

Every `context.mjs` result embeds `commonRules.active` regardless of the target type.
`context.mjs --target <rule-id>` returns the exact rule definition and its source. The Agent applies
the active rules and marks a related Comment resolved only after confirming each verification check.

## Executable frame actions

Significant state changes are captured as a separate outcome Frame instead of mutating Frame DOM
in place. Frame markup declares only the stable action anchor.

```html
<button data-action="action-open-project">Open project</button>
```

```json
{
  "id": "action-open-project",
  "label": "Open project",
  "from": { "frameId": "frame-project-list", "anchor": "action-open-project" },
  "trigger": "click",
  "outcome": { "type": "frame", "frameId": "frame-project-detail" },
  "connectionId": "conn-project-list-detail"
}
```

The protocol recognizes the `click`, `hover`, `scroll` and `input` triggers. The current runtime
provides click-driven outcome Frame transitions plus native scroll/hover proof. Actions are global
stable targets that Notes and Comments can attach to. `policy`, `behavior`, `rationale`,
`edge-case` and `content` Notes are design canon, while Comments are feedback reviewing that
design — the two never substitute for each other.

Connections do not use free curves between Frame centers. `route.from` points at a real Action
anchor and a `top | right | bottom | left` port, and `route.to` points at a port of the outcome
Frame. The runtime routes through 90° orthogonal segments and Canvas gutter lanes. Connections in
opposite directions use different `lane` values so they do not overlap.

```json
{
  "id": "conn-project-list-detail",
  "from": "frame-project-list",
  "to": "frame-project-detail",
  "route": {
    "type": "orthogonal",
    "from": { "type": "action", "id": "action-open-project", "port": "right" },
    "to": { "type": "frame", "id": "frame-project-detail", "port": "left" },
    "lane": 0
  }
}
```

The Canvas splits input ownership explicitly in two.

- **Board review:** the Canvas owns pan/zoom and target selection.
- **Frame interact:** the selected HTML Frame owns scroll/hover/click/keyboard input.

Select a Frame on the board and run it with Enter or a double click. In Frame interact, inner
scrolling is not forwarded to the Canvas, and Escape returns to the board.

### Planning Note view

Planning Notes are not shown as Comment pins or popovers. Turning on the `Planning notes` view
places Note cards on an outer rail around the owning Frame and leaves only a small `N1`, `N2` style
anchor on the target item. Anchors and cards are joined by orthogonal Note links. Selecting the
target item, the numbered anchor or the Note card highlights all three together and moves Canvas
focus to the Note card.

A Note card always shows the full title, kind and text of the planning canon plus the stable Note
ID. Review Comments keep the existing feedback pins and resolution lifecycle, so they never mix
with Planning Notes visually or in the data. The Planning Note view is available only in Board
Review and closes when you enter Frame Interact.

Frame fragments hold markup only. The renderer rejects `<script>` and `<style>`; interaction uses
`data-goto="frame-id"` and `data-toast="message"`. Never copy runtime code into a frame.

Relationship and note sidecars also remain thin:

```json
{
  "groups": [
    { "id": "group-onboarding", "title": "Onboarding", "members": ["frame-entry"] }
  ],
  "connections": [
    { "id": "conn-entry-home", "from": "frame-entry", "to": "frame-home", "label": "continue" }
  ]
}
```

```json
{
  "notes": [
    {
      "id": "note-entry-policy",
      "target": { "type": "frame", "id": "frame-entry", "x": 80, "y": 10 },
      "text": "Why this state exists"
    }
  ]
}
```

## Render and update

After changing data, run a single update command with the package path as its argument.

```sh
node update.mjs examples/reading-list
```

Point it at a Canvas collection root to regenerate and verify several packages at once.

```sh
node update.mjs --all path/to/canvas-root
```

Use the individual render command below only when diagnosing the engine.

```sh
node render.mjs \
  --in examples/reading-list/canvas.json \
  --out examples/reading-list/dist/canvas.html
```

## Selective context

```sh
node context.mjs \
  --canvas examples/reading-list/canvas.json \
  --target frame-reading-home
```

A Frame target returns one fragment plus conditional design dependencies, a Connection target
returns the relation and endpoint summaries, and a Note target returns only the note record. Give a
Comment ID as the target and it tells you the real target to edit and the common rules to apply.

An Action target returns `actions.json` as the only required file and leaves the origin and outcome
Frame sources conditional. Every context result includes the file count and byte count of both
required and conditional reads. A Library target makes `library.json` required and puts the exact
definition and the index of Frames using it directly in the result.
A Rule target makes the shared rules source required and returns the exact rule definition, its
provenance and its verification checks. Every other target includes `commonRules.active` in the
result as well.

## Feedback portability

A Frame Comment binds to a stable Frame target and a revision first; only then does the anchor
shape matter.

```json
{
  "id": "comment-region-example",
  "target": {
    "type": "frame",
    "id": "frame-project-home",
    "anchor": { "kind": "region", "x": 12.5, "y": 24, "width": 48, "height": 18 }
  },
  "targetRevision": "sha256:...",
  "text": "Let's lower the information density of this region",
  "status": "open"
}
```

In comment mode a click creates a point anchor and a drag inside the Frame creates a region anchor.
Coordinates and sizes are percentages relative to the Frame, so they survive Canvas pan/zoom and
Frame repositioning. Existing point and region comment markers show only `open` and `discussion` by
default in Board Review. `resolved` is excluded from the default view and from the comment count in
the header, and in Frame Interact every marker is hidden so it cannot block real HTML input.

Feedback runs on a review cycle separate from the Canvas version. `feedbackRevision` increments once
each time the Agent updates the file. Never conflate Comment workflow status with target revision
state.

- red `open`: not handled yet
- yellow `discussion`: the Agent has a question in the thread and needs a user decision
- `resolved`: records `resolution.summary` and the changed targets; hidden in the default view
- purple/gray dashed `outdated`: a derived marker, independent of the statuses above, meaning the target revision changed

Once all comments are written, the user produces a portable `feedback.json` with `Save feedback`.
The Agent reads the file, does the work, then records a new `targetRevision`, `resolution.summary`,
`changes` and an Agent thread message on each resolved comment. When a decision is needed it flips
the status to `discussion` and leaves the question in the thread. The Agent's result file increments
`feedbackRevision`.

The browser draft key combines the Canvas ID and `review.id`. A stored draft keeps
`baseFeedbackRevision` and `submittedAt`, and an already submitted past draft is not merged once a
higher canonical feedbackRevision is rendered. That way localStorage can never overwrite the
Agent's resolved results back into open/outdated.

The feedback menu offers only `Save feedback` and `Clear all comments`. Clearing all hides every
current comment ID in both the canonical file and the local draft, so the next save produces a
feedback file with an empty comments array. On static `file://` you have to replace the package's
`feedback.json` with the saved file and update the Canvas again.

## Agent session prompt

Use the following prompt when a new Agent session edits an existing Canvas package.

```text
Use the Supercanvas engine at <supercanvas clone path>.
The Canvas source package is <package path>.
Read <supercanvas clone path>/docs/authoring-guide.md before acting.
Begin from a feedback comment ID or stable target ID and run context.mjs before reading source.
Preserve Action/Note/revision contracts, orthogonal port routing and the
Board Review / Frame Interact input boundary. Never edit dist/canvas.html as source.
Run update.mjs after changes.

Task target: <stable-target-id>
Requested change: <describe the change>
```

If you do not know the target ID yet, run the context router with the Canvas ID as the target,
inspect only the Frame and Action index, then pick a concrete target.

## Documentation

- `docs/authoring-guide.md` — workflow for authoring a new Canvas package
- `docs/roadmap.md` — plans for schema versioning, module boundaries and design system work

## License

Apache License 2.0. See [LICENSE](LICENSE).
