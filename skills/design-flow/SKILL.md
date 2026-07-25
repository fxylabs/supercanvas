---
name: design-flow
description: An anti-slop pipeline for planning and designing mobile app and web service UI on supercanvas, Figma-style. Runs in order — reference research → moodboard → concept derivation (locking tokens and rules) → hi-fi — with a user approval gate between every stage. Triggers on requests like "let's nail the design", "let's design this from scratch", "start from the UI concept", "/design-flow <topic>", or their Korean equivalents "디자인 잡자", "새로 디자인하자", "UI 컨셉부터 잡아줘". For simply adding a screen when the concept is already settled, skip this skill and use the supercanvas review loop alone.
---

# design-flow — the supercanvas design pipeline

Jumping straight to hi-fi when asked to "redesign this" produces average design (slop). This skill
enforces a four-stage order with approval gates between the stages. There are two core principles.

1. **Each stage leaves a reviewable artifact on the canvas, and never moves to the next stage without user approval.**
2. **An approved concept is locked as `library.json` tokens and `rules.json` active rules rather than
   prose, and hi-fi uses nothing else.**

## 0. Setup — scaffold

- Confirm the CLI is installed with `supercanvas help`. If not, clone the supercanvas repo and `npm link`.
- Create the package with `supercanvas new <project>/.data/canvas/<topic> --title "<topic>"`.
  If the user names a location, use that instead.
- In every stage that follows: add the artifact → `supercanvas update <slug>` → `supercanvas view <slug>`
  to show the user, then collect feedback through comments or conversation.

## 1. Reference research

- Research **3–5 real products or sites** with WebSearch/WebFetch. Never invent references from
  memory. A reference without a source URL does not go into the artifact.
- Record each reference as a note (or frame): product name, URL, 1–3 things this project should learn
  from it, and what to avoid. Do not collect only similar references — mix different densities and tones.
- Gate: the user must agree with the reference direction before the next stage.

## 2. Moodboard

- Build 3–4 candidate direction frames. Each frame shows one combination of typography, color,
  density and tone as actual design fragments (header, card, button, and so on). The candidates must
  be **genuinely different** — a recolored variant of the same design is not a candidate.
- Attach a note to each frame with the rationale for that direction (which reference it came from).
- Gate: the user must pick one direction via comment or specify a combination before the next stage.

## 3. Concept derivation — lock it as tokens and rules

- Produce 2–3 concept candidates from the approved direction. Present each with a name, a
  one-paragraph rationale and one representative screen.
- The moment the user approves one, lock it:
  - `library.json` — color, type, spacing and radius tokens plus the core component definitions.
  - `rules.json` — the rules that protect the concept (e.g. "body text uses X only", "the accent
    color is for CTAs only"). Only rules the user approved are `active`; rules the agent inferred stay `proposed`.
- Gate: the tokens and rules must be recorded and confirmed by the user before moving to hi-fi.

## 4. Hi-fi

- Build screen frames using only the locked tokens and active rules. If a new color or typeface is
  needed, do not add it ad hoc — propose adding the token first.
- Make every screen pass render+verify via `supercanvas update`.
- Feedback follows the supercanvas review loop: comment target ID →
  `supercanvas context --target <id>` → edit only the returned minimum source → update → review again.

## Done criteria

- References, moodboard, concept and hi-fi all live in one package, and each stage had user approval.
- Every hi-fi frame passes verify and there are no open comments.
