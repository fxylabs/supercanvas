# Supercanvas Roadmap

여러 프로젝트에서 재사용할 수 있는 캔버스 기반을 단단하게 만들기 위한 개선 계획이다.
각 트랙은 독립적으로 진행할 수 있다.

## Invariants

개선 과정에서도 다음 조건은 유지한다.

1. Canvas, Frame, Group, Connection, Action, Note, Comment와 Library target은 전역적으로
   충돌하지 않는 stable ID를 가진다.
2. ID는 표시 순서나 좌표가 바뀌어도 유지하며 삭제된 ID를 다른 객체에 재사용하지 않는다.
3. 생성된 HTML은 output-only다. 모든 변경은 source 또는 renderer/runtime에서 시작한다.
4. Frame fragment에는 `<script>`와 `<style>`을 넣지 않는다.
5. Frame은 사용하는 token/component source를 manifest의 `uses`로 명시한다.
6. Comment identity는 좌표가 아니라 stable target과 revision에 연결한다. Point/region geometry는
   Frame 내부 anchor 표현이며 target identity를 대체하지 않는다.
7. Connection과 Note도 Frame과 동등한 review target이 될 수 있다.
8. JSON feedback은 localStorage보다 우선하는 portable canon이다. localStorage는 미반영 draft다.
9. Connection은 Action 또는 target의 상하좌우 port에서 출발하고 90° orthogonal route와
   gutter lane을 사용한다.
10. Design Library 정의가 canonical source다. Canvas UI Kit은 같은 정의의 preview이고 특정
    framework code 생성은 선택적 adapter다.
11. Comment workflow status `open | discussion | resolved`와 revision state
    `current | outdated | unbound`를 분리한다.
12. 사용자가 명시한 공통 규칙은 active로 기록할 수 있다. Agent가 추론한 규칙은 proposed로
    제안하고 사용자 승인 전에는 active로 승격하지 않는다.

## A. Core model and renderer

- schema를 명시적으로 versioning하고 migration 전략을 정한다.
- stable ID 생성, 참조 무결성, cycle/duplicate/error reporting을 강화한다.
- 대형 캔버스에서도 frame source를 선택적으로 load/render할 수 있는 경계를 검토한다.
- deterministic output과 source hash/revision metadata를 추가한다.
- renderer, context router와 feedback importer/exporter를 독립 모듈로 분리할지 결정한다.
- invalid source가 전체 캔버스를 깨뜨리지 않고 target 단위 오류로 보이게 한다.

## B. Interaction and review

- pan, zoom, fit, minimap, keyboard navigation과 focus 이동을 정리한다.
- Frame뿐 아니라 Connection, Group, Note를 명확하게 선택하고 comment할 수 있게 한다.
- comment create/edit/resolve/reopen/delete 흐름과 visible status를 검증한다.
- Board Review에서는 Canvas가 pan/zoom을 소유하고 Frame Interact에서는 HTML Frame이
  scroll/hover/click/keyboard input을 소유한다. Escape는 Board focus로 복귀한다.
- comment가 가리키는 target revision이 변경됐을 때 outdated/review-needed 상태를 정의한다.
- JSON import/export가 ID, target, revision, author placeholder와 status를 보존하게 한다.
- 접근성, reduced motion, high contrast, 200% zoom과 긴 텍스트를 점검한다.

## C. Design system

- semantic token과 component token을 분리하고 light/dark/high-contrast 확장 가능성을 남긴다.
- Frame 내부 제품 UI와 Canvas 자체 chrome의 스타일 namespace를 분리한다.
- Frame, Group, Connector, Note, Pin, Toolbar, Inspector, Comment modal의 상태 표를 만든다.
- selected, hovered, commented, resolved, changed, invalid, blocked 상태가 색상에만 의존하지 않게 한다.
- 아이콘은 이름, 용도, size, stroke 규칙을 가진 asset registry로 관리한다.
- Foundation, Layout, Component와 Story를 `library.json`의 stable target으로 관리한다.
- Canvas header의 UI Kit view에서 검색, 상태 preview와 exact JSON definition을 제공한다.
- React/CSS 등 특정 구현 산출물보다 플랫폼 중립 UI/UX 계약을 우선한다.

## D. Token efficiency

- 모든 작업은 stable target ID에서 시작한다.
- context result의 `required`만 먼저 읽고 `conditional`은 실제 변경에 필요할 때만 읽는다.
- frame summary와 relation metadata만으로 대상을 식별할 수 있어야 한다.
- 공통 디자인 변경은 token/component source 한 번으로 끝나야 한다.
- context router가 반환한 파일 수와 byte 수를 측정해 회귀를 확인한다.
- generated HTML, bundled runtime, 무관한 Frame source를 기본 Agent context에 넣지 않는다.

## Verification contract

engine을 변경한 뒤 최소 검증:

```sh
node --check render.mjs
node --check context.mjs
node --check runtime/board.js
node update.mjs examples/reading-list
node context.mjs \
  --canvas examples/reading-list/canvas.json \
  --target frame-reading-home
```

또한 다음을 직접 확인한다.

- unresolved template placeholder가 없다.
- duplicate/dangling ID와 relation target이 없다.
- 생성 결과를 다시 source로 수정하지 않는다.
- comment JSON export/import 후 target과 status가 보존된다.
- mouse와 keyboard로 대표 interaction을 수행할 수 있다.
