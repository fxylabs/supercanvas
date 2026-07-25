# Supercanvas

Agent가 만들고 사람이 검토하는 local design-artifact canvas다. HTML Frame을 정적 이미지가
아니라 실제로 scroll, hover, click, keyboard로 실행하고, 사람이 stable target ID에 피드백을
남기면 Agent가 전체 캔버스를 읽지 않고 해당 target의 최소 source만 수정하는 review loop를
제공한다.

```text
Agent renders a visual artifact
→ person comments on a stable target
→ context router returns the minimum relevant source
→ Agent edits only that target and its declared dependencies
→ render, compare and review again
```

핵심 구성요소:

- `render.mjs` — data package를 standalone HTML canvas로 렌더링
- `context.mjs` — target ID를 최소 source 파일 집합으로 해석하는 selective context router
- `verify.mjs` — schema, ID 무결성, feedback round-trip, context cost 검증
- `update.mjs` — package 렌더 + 검증을 한 번에 실행
- `runtime/` — pan/zoom board, Frame interact, feedback, UI Kit, rules viewer
- `templates/minimal/` — 새 Canvas package의 최소 skeleton

## Quickstart

```sh
git clone https://github.com/fxylabs/supercanvas.git
cd supercanvas
npm link                      # 전역 supercanvas 커맨드 설치
supercanvas update examples/reading-list
supercanvas view examples/reading-list
```

`supercanvas new <dir>`로 새 package를 스캐폴드하고, `add`로 기존 package를 머신 레지스트리
(`~/.supercanvas/registry.json`)에 등록하면 이후 모든 커맨드에서 경로 대신 slug를 쓸 수 있다.
전체 커맨드는 `supercanvas help`, 설계는 `docs/cli-design.md`를 본다.

Output은 CSS, runtime과 JSON snapshot을 내장한 standalone HTML이므로 `file://`로 열 수 있다.
Generated output은 Agent input이 아니다.

새 Canvas package를 만드는 절차는 `docs/authoring-guide.md`를 따른다. engine 코드는 복사하지
않고 data package만 작성한다.

## Agent editing boundary

Agent가 기본적으로 읽고 수정할 것은 target router가 반환한 최소 source뿐이다.

1. 먼저 `feedback.json`의 comment ID 또는 stable target ID를 확인한다.
2. `context.mjs`로 필요한 source path를 resolve한다.
3. 모든 context 결과의 `commonRules.active`를 먼저 적용하고 verification checks를 완료 조건에 포함한다.
4. UI/UX 작업이면 Canvas target의 `libraryIndex`를 확인하고 기존 Library ID를 먼저 조회한다.
5. Frame 작업이면 해당 `frames/<frame-id>.html`만 읽는다.
6. Relation/Note 작업이면 각각 `relations.json`/`notes.json`만 읽는다.
7. 전역 visual 변경일 때만 token/component source를 추가로 읽는다.

`runtime/`과 `render.mjs`는 canvas infrastructure다. 프레임을 설계하거나 정책을 수정할 때
읽을 필요가 없다. 생성된 `canvas.html`도 검토 결과물이며 source가 아니다.

## Thin manifest

```json
{
  "schemaVersion": 2,
  "canvas": {
    "id": "canvas-unique-id",
    "title": "Canvas title",
    "version": "v1",
    "language": "ko"
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

- canvas 안에서 unique
- lowercase letter로 시작
- lowercase letters, digits, hyphen만 사용
- 3–64 characters
- comment, connection, tab과 exported feedback의 stable anchor

Frame 외에도 Canvas, Group, Connection, Note, Comment와 Library/Foundations/Layouts/Components/Stories가
같은 형식의 unique stable ID를 가진다. `relations.json`, `notes.json`, `feedback.json`의 모든
참조는 renderer가 target type과 함께 검증한다.

Schema v2는 `action-*` target과 `actions.json`, deterministic revision metadata를 추가한다.
Renderer와 context router는 v1 package를 읽을 때 v2 형태로 memory migration하지만 source를
자동으로 덮어쓰지 않는다. 다음 major schema가 나오기 전까지 v1 read compatibility를 유지한다.

## Design Library inside Canvas

`library.json`은 Canvas 안의 Storybook형 UI Kit과 Agent context가 함께 읽는 canonical definition
data다. React component나 CSS 파일은 필수 source가 아니다. Agent는 props, state, slot, event,
token dependency, accessibility와 usage guidance를 읽고 목적 프로젝트에 맞는 구현을 만든다.

```json
{
  "id": "ui-button",
  "name": "Button",
  "description": "명확한 사용자 action을 실행하는 semantic button.",
  "contract": {
    "element": "button",
    "className": "sc-button",
    "props": {
      "variant": {
        "type": "enum",
        "values": ["primary", "secondary", "danger"],
        "default": "primary",
        "description": "action 중요도와 위험도"
      }
    },
    "slots": ["default", "leadingIcon"],
    "events": ["click"],
    "states": ["default", "hover", "focus-visible", "disabled"],
    "tokens": ["color.accent", "radius.md"]
  },
  "accessibility": ["accessible name 필수", "keyboard focus 표시 유지"],
  "guidance": {
    "use": ["동사형 action"],
    "avoid": ["탐색 링크를 button으로 표현"]
  },
  "stories": [
    { "id": "story-button-primary", "title": "Primary", "props": { "variant": "primary" } }
  ]
}
```

Canvas header의 `UI Kit` view는 foundations, layouts와 components를 검색하고 Story를 실행하며
각 항목의 exact JSON definition을 표시·복사한다. Frame은 manifest의 `libraryUses`로 Library
dependency를 선언하고 실제 component root에는 `data-ui`를 둔다.

```html
<button class="sc-button" data-ui="ui-button" type="button">New project</button>
```

Renderer는 `data-ui`가 등록된 component인지, Frame의 `libraryUses`에도 선언됐는지 검증한다.
`context.mjs --target ui-button`은 전체 generated HTML 대신 정확한 component definition, 사용
Frame과 선택적 token/source 경로만 반환한다.

## Common Rules inside Canvas

`rules.json`은 UI Kit과 별개로 Agent의 Canvas authoring behavior를 제한하는 규칙 계약이다.
각 package 안에 복제하지 않으려면 Canvas collection에 공유 파일을 둔다.

```text
canvas-root/
├── _shared/rules.json
├── product-flow/
└── onboarding-review/
```

manifest에 `sources.rules`가 없으면 renderer와 context router가 `../_shared/rules.json`을 자동으로
찾는다. package 전용 규칙이 필요할 때만 `sources.rules: "rules.json"`을 명시한다.

```json
{
  "schemaVersion": 2,
  "rulesRevision": 1,
  "scope": "workspace",
  "rules": [
    {
      "id": "rule-frame-input-ownership",
      "title": "Canvas와 Frame 입력 소유권을 분리한다",
      "status": "active",
      "priority": "must",
      "category": "interaction",
      "statement": "보드와 댓글 모드에서는 Canvas가 pan/zoom을 소유한다.",
      "rationale": "Frame interaction과 Canvas navigation의 충돌을 막는다.",
      "appliesTo": ["canvas", "frame"],
      "source": { "type": "user-instruction", "ref": "input-modes" },
      "verification": {
        "type": "agent-checklist",
        "checks": ["댓글 모드의 Frame 위 wheel이 Canvas를 이동한다."]
      }
    }
  ]
}
```

`status`는 `active | proposed | deprecated`, `priority`는 `must | should`다. 사용자가 명시적으로
공통 규칙을 요청하면 Agent가 active rule로 기록한다. 댓글에서 Agent가 일반화한 규칙은
`ruleProposal.status: proposed`로 제안하고 사용자 승인 전에는 active로 승격하지 않는다.
Canvas header의 `공통 규칙` view에서 활성 규칙, 승인 대기 후보, provenance와 verification을
검색·검토할 수 있다.

모든 `context.mjs` 결과는 target 종류와 관계없이 `commonRules.active`를 내장한다.
`context.mjs --target <rule-id>`는 정확한 규칙 정의와 source를 반환한다. Agent는 active rule을
적용하고 각 verification check를 확인한 뒤에만 관련 Comment를 resolved로 바꾼다.

## Executable frame actions

중요한 상태 변화는 Frame 내부 DOM을 임시로 바꾸지 않고 별도 outcome Frame으로 남긴다.
Frame markup은 stable action anchor만 선언한다.

```html
<button data-action="action-open-project">프로젝트 열기</button>
```

```json
{
  "id": "action-open-project",
  "label": "프로젝트 열기",
  "from": { "frameId": "frame-project-list", "anchor": "action-open-project" },
  "trigger": "click",
  "outcome": { "type": "frame", "frameId": "frame-project-detail" },
  "connectionId": "conn-project-list-detail"
}
```

`click`, `hover`, `scroll`, `input` trigger를 protocol이 인식한다. 현재 runtime은 click outcome
Frame 전환과 native scroll/hover proof를 제공한다. Action은 Note와 Comment가 연결될 수 있는
전역 stable target이다. `policy`, `behavior`, `rationale`, `edge-case`, `content` Note는 설계 canon이고,
Comment는 그 설계를 검토하는 feedback이므로 서로 대체하지 않는다.

Connection은 Frame 중심을 잇는 자유곡선을 사용하지 않는다. `route.from`은 실제 Action
anchor와 `top | right | bottom | left` port를 가리키고, `route.to`는 결과 Frame의 port를
가리킨다. Runtime은 90° orthogonal segment와 Canvas gutter lane으로 라우팅한다. 반대 방향
Connection은 다른 `lane`을 사용해 겹치지 않게 한다.

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

Canvas는 두 입력 소유권을 명시적으로 나눈다.

- **Board review:** Canvas가 pan/zoom과 target selection을 소유한다.
- **Frame interact:** 선택한 HTML Frame이 scroll/hover/click/keyboard input을 소유한다.

Board에서 Frame을 선택하고 Enter 또는 double click으로 실행한다. Frame interact에서는 내부
scroll이 Canvas로 전달되지 않으며 Escape로 Board에 돌아간다.

### Planning Note view

기획 Note는 Comment pin이나 popover로 표시하지 않는다. `기획 노트` view를 켜면 Note card를
소유 Frame 주변의 외부 rail에 배치하고, target item에는 `N1`, `N2` 형식의 작은 anchor만 둔다.
Anchor와 card는 orthogonal Note link로 연결한다. Target item, 번호 anchor 또는 Note card를
선택하면 세 요소가 함께 강조되고 Canvas focus가 Note card로 이동한다.

Note card는 항상 기획 canon의 전체 title, kind, text와 stable Note ID를 보여준다. Review
Comment는 기존 feedback pin과 resolution lifecycle을 유지하므로 Planning Note와 시각적으로나
데이터상으로 섞이지 않는다. Planning Note view는 Board Review에서만 활성화되며 Frame
Interact에 들어가면 종료된다.

Frame fragment에는 markup만 둔다. `<script>`와 `<style>`은 renderer가 거부하며 interaction은
`data-goto="frame-id"`와 `data-toast="message"`를 사용한다. Runtime code를 프레임에
복제하지 않는다.

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

data 변경 후 package 경로를 인자로 업데이트 명령 하나를 실행한다.

```sh
node update.mjs examples/reading-list
```

Canvas collection root를 지정하면 여러 package를 한 번에 다시 생성하고 검증한다.

```sh
node update.mjs --all path/to/canvas-root
```

아래 개별 render 명령은 engine을 진단할 때 사용한다.

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

Frame target은 one fragment와 conditional design dependencies, Connection target은 관계와
endpoint summary, Note target은 note record만 반환한다. Comment ID를 target으로 주면 실제
수정 target과 적용할 공통 규칙을 안내한다.

Action target은 `actions.json` 한 파일만 required로 반환하고 출발/결과 Frame source는
conditional로 둔다. 모든 context 결과에는 required/conditional 파일 수와 byte 수가 포함된다.
Library target은 `library.json`을 required로 하고 exact definition과 이를 사용하는 Frame index를
결과에 직접 포함한다.
Rule target은 공유 rules source를 required로 하고 exact rule definition, provenance와 verification
checks를 반환한다. 그 외 모든 target도 `commonRules.active`를 결과에 포함한다.

## Feedback portability

Frame Comment는 stable Frame target과 revision에 연결한 뒤 anchor 형태만 구분한다.

```json
{
  "id": "comment-region-example",
  "target": {
    "type": "frame",
    "id": "frame-project-home",
    "anchor": { "kind": "region", "x": 12.5, "y": 24, "width": 48, "height": 18 }
  },
  "targetRevision": "sha256:...",
  "text": "이 영역의 정보 밀도를 낮추자",
  "status": "open"
}
```

댓글 작성 모드에서 click은 point anchor, Frame 내부 drag는 region anchor를 만든다. 좌표와 크기는
Frame 기준 percentage이므로 Canvas pan/zoom이나 Frame 위치 변경과 무관하다. 기존 point와 region
댓글 marker는 Board Review에서 `open`과 `discussion`만 기본 노출한다. `resolved`는 기본 화면과
헤더 댓글 수에서 제외하며, Frame Interact에서는 실제 HTML 입력을 막지 않도록 모든 marker를 숨긴다.

Feedback은 Canvas version과 별도의 review cycle을 가진다. `feedbackRevision`은 Agent가 파일을
갱신할 때 한 번 증가한다. Comment workflow status와 target revision 상태를 섞지 않는다.

- 빨강 `open`: 아직 처리되지 않음
- 노랑 `discussion`: Agent 질문이 thread에 있고 사용자 결정이 필요함
- `resolved`: `resolution.summary`와 변경 target이 기록되며 기본 화면에서는 숨김
- 보라/회색 점선 `outdated`: 위 status와 별개로 target revision이 변경됐다는 파생 표시

사용자는 댓글을 모두 작성한 뒤 `저장하기`로 portable `feedback.json`을 만든다. Agent는
파일을 읽고 작업한 뒤 resolved 댓글에 새 `targetRevision`, `resolution.summary`, `changes`와
Agent thread message를 남긴다. 결정이 필요하면 status를 `discussion`으로 바꾸고 thread에 질문을
남긴다. Agent 결과 파일은 `feedbackRevision`을 증가시킨다.

Browser draft key에는 Canvas ID와 `review.id`가 함께 들어간다. 저장된 draft에는
`baseFeedbackRevision`과 `submittedAt`이 남으며, 더 높은 canonical feedbackRevision이 렌더되면
제출 완료된 과거 draft는 병합하지 않는다. 따라서 localStorage가 Agent의 resolved 결과를 다시
open/outdated 상태로 덮어쓸 수 없다.

피드백 메뉴는 `저장하기`와 `전체 댓글 클리어`만 제공한다. 전체 클리어는 canonical과 local draft의
현재 댓글 ID를 모두 숨기고, 이후 저장하기로 빈 comments 배열을 가진 feedback 파일을 만든다.
Static `file://`에서는 저장된 파일을 package의 `feedback.json`으로 교체하고 Canvas를 다시
업데이트해야 한다.

## Agent session prompt

새 Agent 세션에서 기존 Canvas package를 편집할 때 다음 prompt를 사용한다.

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

대상 ID를 아직 모르면 Canvas ID를 target으로 context router를 실행해 Frame과 Action index만
확인한 뒤 구체 target을 선택한다.

## Documentation

- `docs/authoring-guide.md` — 새 Canvas package 작성 workflow
- `docs/roadmap.md` — schema versioning, module boundary, design system 개선 계획

## License

Apache License 2.0. See [LICENSE](LICENSE).
