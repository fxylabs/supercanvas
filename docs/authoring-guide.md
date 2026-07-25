# Canvas Authoring Guide

이 가이드의 목표는 어느 프로젝트에서든 Canvas를 만들 때 renderer, context router, runtime,
feedback protocol을 다시 만들거나 복사하지 않고 Canvas별 source data만 작성하게 하는 것이다.

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

Supercanvas의 JavaScript, runtime CSS와 template은 Canvas package로 복사하지 않는다.
공통 engine은 manifest 위치와 상관없이 `--in <package>/canvas.json`을 읽도록 만들어져 있다.
Frame source, 관계, Action, Note, feedback과 해당 Canvas의 visual source만 package에 둔다.

사용하는 프로젝트에서 `.data/`를 공통 ignore 대상으로 두면 제품 코드를 작업하면서 Canvas를
만들어도 Canvas source와 generated HTML이 commit 대상에 섞이지 않는다. Canvas package를
제품 저장소의 tracked source로 관리할지는 각 프로젝트가 정한다.

## 2. Locate the shared engine

engine은 supercanvas clone 하나로 공유한다.

```sh
export SUPERCANVAS_KIT=/path/to/supercanvas
```

worktree마다 engine 사본을 만들지 않는다. 같은 컴퓨터의 모든 프로젝트가 위 clone 하나를
absolute path로 사용한다.

## 3. Create a data-only package

작업 중인 프로젝트 root에서 package 위치를 정한다.

```sh
export SUPERCANVAS_PACKAGE="$PWD/.data/canvas/project-review"
mkdir -p "$PWD/.data/canvas"
cp -R "$SUPERCANVAS_KIT/templates/minimal" "$SUPERCANVAS_PACKAGE"
```

복사되는 것은 Canvas source skeleton뿐이며 공통 runtime code는 포함되지 않는다. 첫 render 전에
다음을 반드시 교체한다.

1. `canvas.json`의 `canvas.id`, title, version
2. 모든 sidecar의 `canvasId`
3. `feedback.json`의 `canvasVersion`
4. 첫 Frame ID, source filename, title과 summary
5. Frame fragment와 Canvas-specific style
6. `library.json`의 Library ID, title과 definition data

공통 규칙은 package마다 복사하지 않는다. `.data/canvas/_shared/rules.json`을 한 번 만들고
manifest의 `sources.rules`는 생략한다. Renderer와 context router가 sibling `_shared` 파일을
자동으로 읽는다. package 전용 규칙이 필요한 예외에서만 package 내부 `rules.json`을 선언한다.

ID는 package 안에서 전역 unique해야 하며 다른 Canvas에서도 재사용하지 않는 것을 원칙으로
한다. 좌표, 표시 순서, title이 바뀌어도 stable ID는 유지한다.

## 4. What belongs in Canvas data

| Source | 책임 |
|---|---|
| `canvas.json` | Canvas metadata, Frame index, source routing, layout |
| `relations.json` | Group, Connection과 orthogonal port route |
| `actions.json` | HTML Action anchor, trigger, outcome Frame |
| `notes.json` | behavior, policy, rationale, edge-case, content canon |
| `feedback.json` | portable review Comment와 target revision |
| `library.json` | Agent-readable foundation, layout, component와 Story 계약 |
| `../_shared/rules.json` | 모든 Canvas 작업에 적용되는 active/proposed 규칙과 verification 계약 |
| `frames/*.html` | markup-only executable HTML state |
| `styles/*.css` | 이 Canvas에만 필요한 visual composition |
| `design/*` | 선택적인 shared token/component source |
| `dist/canvas.html` | generated standalone output; source로 읽거나 수정하지 않음 |

다음은 Canvas package에 복사하지 않는다.

- `render.mjs`, `context.mjs`, `verify.mjs`, `protocol.mjs`, `library.mjs`, `rules.mjs`
- `runtime/board.js`, `runtime/canvas.css`, `runtime/template.html`
- pan/zoom, feedback import/export, Frame picker, Planning Note view 구현

공통 동작에 문제가 있으면 supercanvas engine을 한 번 수정한다. 특정 Canvas의 화면, 관계,
정책이나 visual 표현만 package data에서 수정한다.

## 5. Update with the shared engine

사용처에서는 package data를 고친 뒤 공유 engine의 `update.mjs`만 실행한다. Canvas package
폴더에서 실행하면 현재 package 하나를 최신 runtime으로 다시 생성하고 검증한다.

```sh
cd "$SUPERCANVAS_PACKAGE"
node "$SUPERCANVAS_KIT/update.mjs"
```

worktree root에서 인자 없이 실행하면 `.data/canvas/*/canvas.json`을 찾아 모든 local Canvas를
업데이트한다.

```sh
cd <current-worktree-root>
node "$SUPERCANVAS_KIT/update.mjs"
```

특정 package 또는 별도 Canvas root를 명시할 수도 있다.

```sh
node "$SUPERCANVAS_KIT/update.mjs" .data/canvas/project-review
node "$SUPERCANVAS_KIT/update.mjs" --all .data/canvas
```

이 명령은 각 package의 `dist/canvas.html`을 현재 공유 engine으로 render한 뒤 `verify.mjs`를 실행한다.
Canvas source data를 자동 변경하거나 schema migration하지 않는다. 검증이 실패하면 해당 package에서
중단하며 오류를 그대로 반환한다.

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

`verify.mjs`는 특정 Frame 이름에 의존하지 않는다. 임의 Canvas package에 대해 schema,
global ID, target revision, Action reference, feedback round-trip, selective context cost와 generated
snapshot을 검사한다. Action이나 Comment가 아직 없는 최소 package도 검증할 수 있다.

대부분의 사용처는 `update.mjs`를 사용한다. renderer나 verifier를 따로 진단할 때만 위 명령을
개별 실행한다.

## 7. Agent editing workflow

모든 작업은 stable target ID에서 시작한다.

```text
feedback Comment ID 또는 target ID 확인
→ context.mjs 실행
→ commonRules.active와 verification checks 확인
→ UI/UX 작업이면 Library index 또는 stable component ID 조회
→ read.required만 먼저 읽기
→ 실제 변경에 필요할 때만 read.conditional 읽기
→ data/fragment/style source 수정
→ update.mjs
→ dist/canvas.html에서 interaction review
```

Canvas 전체에서 대상을 찾을 때도 generated HTML을 읽지 않는다. Canvas ID로 context router를
실행해 Frame/Action index와 byte metrics를 확인한 뒤 구체 target으로 다시 실행한다.

UI/UX 작업에서는 Frame HTML을 만들기 전에 Canvas context의 `libraryIndex`를 확인한다. 적합한
stable component/layout ID가 있으면 해당 ID로 context를 다시 실행한다.

```sh
node "$SUPERCANVAS_KIT/context.mjs" \
  --canvas "$SUPERCANVAS_PACKAGE/canvas.json" \
  --target ui-button
```

결과의 `definition`은 특정 React/CSS 문법이 아니라 props, states, slots, events, token 의존성,
accessibility와 use/avoid 기준을 담은 구현 계약이다. Agent는 이 정의를 목적 프로젝트의 기술과
convention에 맞게 구현하되, 정의되지 않은 variant나 state를 임의로 만들지 않는다.

Feedback 파일을 받은 Agent는 각 Comment target으로 context를 조회하고 작업한다. 완료된 Comment는
새 target hash에 연결한 뒤 `status: resolved`, `resolution.summary`, `resolution.changes`와 Agent
thread message를 기록한다. 제품 판단이 필요한 Comment는 `status: discussion`으로 두고 구체적인
질문을 Agent thread message로 남긴다. 파일 저장 시 `feedbackRevision`을 한 번 증가시키고 render를
다시 실행한다. Canvas version 상승이나 comments 전체 삭제로 review history를 정리하지 않는다.
Canvas 기본 화면은 `open`과 `discussion` pin만 표시하고 `resolved`는 헤더 수와 화면에서 숨긴다.
사용자가 현재 review를 비우라고 명시하면 `전체 댓글 클리어` 후 저장한 feedback 파일의 빈
comments 배열을 canonical source에 반영한다.

사용자가 대화에서 명시적으로 공통 규칙을 요청하면 Agent는 `_shared/rules.json`에 provenance와
verification을 포함한 `active` rule을 추가하고 `rulesRevision`을 한 번 증가시킨다. 댓글 피드백이
여러 Frame/Canvas에 재사용될 수 있다고 판단하면 바로 active로 만들지 않는다. Comment의
`ruleProposal.status`를 `proposed`로 두고 구체적인 statement, rationale, appliesTo와 checks를 작성한
뒤 사용자 승인을 요청한다. 사용자가 `공통 규칙` view에서 승인한 feedback을 저장하면 proposal은
`approved`가 된다. Agent는 다음 feedback 처리에서 이를 shared active rule로 승격하고
`source: { "type": "feedback", "ref": "<comment-id>" }` provenance를 유지한다.

## 8. Frame, Action and Note rules

- Frame fragment에는 `<script>`와 `<style>`을 넣지 않는다.
- UI Kit view는 Canvas header의 `UI Kit`에서 열며 Library 정의와 Story preview를 같은 output에서 본다.
- Frame이 사용하는 Library 항목은 `libraryUses`에 stable ID로 선언한다.
- 실제 markup의 재사용 component root에는 `data-ui="<component-id>"`를 표시한다. Renderer는
  `data-ui`와 `libraryUses`가 맞지 않거나 미등록 component이면 실패한다.
- native HTML scroll, hover와 input은 Frame Interact에서 실행한다.
- 중요한 click 결과는 별도 Frame으로 만들고 Action outcome으로 연결한다.
- Action element에는 `data-action="action-id"`를 둔다.
- Connection은 실제 Action의 상하좌우 port에서 출발해 orthogonal gutter route를 사용한다.
- 기획 Note는 Planning Note view에서 Frame 주변 card로 보이며 번호 anchor로 item과 연결된다.
- Comment와 Note는 별도 canon과 lifecycle을 유지한다.
- Frame feedback은 `anchor.kind: point | region`을 사용한다. Region의 x/y/width/height는 Frame
  기준 percentage이며 Comment는 여전히 stable Frame ID와 target revision에 연결한다.
- Frame Interact와 Planning Note view는 동시에 활성화하지 않는다.
- 모든 target 작업 전에 `commonRules.active`를 적용하고 rule의 verification checks를 완료한다.
- Agent가 댓글에서 추론한 공통 규칙은 사용자 승인 전까지 proposed 상태를 유지한다.

구체 schema 예시는 repository root의 `README.md`와 `examples/reading-list/`를 따른다.

## 9. Ready-to-paste prompt for another session

새 Agent 세션을 열고 다음 prompt를 사용한다.

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

새 session이 guide나 engine path를 읽을 수 없다면 진행하지 말고 올바른 supercanvas clone
path를 먼저 확인한다. 임의의 runtime 대체 구현을 Canvas package 안에 만들지 않는다.

## 10. Tracking boundary

Canvas package는 기본적으로 사용하는 프로젝트의 local 검토 자료다. package를 그 프로젝트의
tracked canonical source로 포함하려는 시점부터 해당 저장소의 review와 branch workflow를
적용한다. engine 자체의 변경은 이 supercanvas 저장소의 issue와 PR로 다룬다.
