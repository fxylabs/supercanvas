---
name: design-flow
description: 모바일 앱·웹 서비스 UI를 supercanvas 위에서 피그마처럼 기획·디자인하는 anti-slop 파이프라인. 레퍼런스 조사 → 무드보드 → 컨셉 도출(토큰·규칙 고정) → hi-fi 순서로 진행하며 단계마다 사용자 승인 게이트를 둔다. "디자인 잡자", "새로 디자인하자", "UI 컨셉부터 잡아줘", "/design-flow <주제>" 같은 요청에 발동. 이미 컨셉이 확정된 상태의 단순 화면 추가는 이 스킬 없이 supercanvas 리뷰 루프만 쓴다.
---

# design-flow — supercanvas 디자인 파이프라인

"디자인을 새로 잡자"에 바로 hi-fi부터 만들면 평균적인 디자인(slop)이 나온다. 이 스킬은
4단계 순서와 단계 사이 승인 게이트를 강제한다. 핵심 원칙은 2가지다.

1. **각 단계는 캔버스에 검토 가능한 산출물을 남기고, 사용자 승인 없이 다음 단계로 넘어가지 않는다.**
2. **승인된 컨셉은 산문이 아니라 `library.json` 토큰과 `rules.json` active 규칙으로 고정하고,
   hi-fi는 그것만 사용한다.**

## 0. 준비 — 스캐폴드

- `supercanvas help`로 CLI 설치를 확인한다. 없으면 supercanvas 레포를 clone 후 `npm link`.
- `supercanvas new <프로젝트>/.data/canvas/<주제> --title "<주제>"`로 package를 만든다.
  위치를 사용자가 지정하면 그곳을 따른다.
- 이후 모든 단계에서 산출물 추가 → `supercanvas update <slug>` → `supercanvas view <slug>`로
  사용자에게 보여주고 comment 또는 대화로 피드백을 받는다.

## 1. 레퍼런스 조사

- WebSearch/WebFetch로 **실제 제품·사이트 3~5개**를 조사한다. 기억으로 레퍼런스를 지어내지
  않는다. 출처 URL이 없는 레퍼런스는 산출물에 넣지 않는다.
- 레퍼런스마다 note(또는 frame)로 기록한다: 제품명, URL, 이 프로젝트가 배울 점 1~3개,
  피할 점. 서로 비슷한 레퍼런스만 모으지 말고 밀도·톤이 다른 것을 섞는다.
- 게이트: 사용자가 레퍼런스 방향에 동의해야 다음 단계로 간다.

## 2. 무드보드

- 방향 후보 frame 3~4장을 만든다. 각 frame은 타이포그래피, 컬러, 밀도, 톤의 한 조합을
  실제 시안 조각(헤더·카드·버튼 등)으로 보여준다. 후보끼리 **실제로 달라야** 한다 —
  같은 디자인의 색만 바꾼 변형은 후보가 아니다.
- 각 frame에 그 방향의 근거(어느 레퍼런스에서 왔는지)를 note로 연결한다.
- 게이트: 사용자가 comment로 한 방향을 고르거나 조합을 지시해야 다음 단계로 간다.

## 3. 컨셉 도출 — 토큰·규칙으로 고정

- 승인된 방향에서 컨셉 후보 2~3개를 만든다. 각 후보는 이름, 한 문단 근거, 대표 화면
  1장으로 제시한다.
- 사용자가 하나를 승인하면 즉시 고정한다:
  - `library.json` — 컬러·타이포·간격·radius 토큰과 핵심 컴포넌트 정의.
  - `rules.json` — 컨셉을 지키는 규칙(예: "본문 서체는 X만", "액센트 컬러는 CTA에만").
    사용자가 승인한 규칙만 `active`, 에이전트가 추론한 규칙은 `proposed`로 둔다.
- 게이트: 토큰·규칙이 기록되고 사용자가 확인해야 hi-fi로 간다.

## 4. Hi-fi

- 고정된 토큰과 active 규칙만 사용해 화면 frame을 만든다. 새 색·새 서체가 필요하면
  임의로 추가하지 말고 토큰 추가를 먼저 제안한다.
- 화면마다 `supercanvas update`로 render+verify를 통과시킨다.
- 피드백은 supercanvas 리뷰 루프를 따른다: comment의 target ID →
  `supercanvas context --target <id>` → 반환된 최소 source만 수정 → update → 재검토.

## 완료 조건

- 레퍼런스·무드보드·컨셉·hi-fi가 한 package 안에 남아 있고, 각 단계에 사용자 승인이 있었다.
- hi-fi frame이 전부 verify를 통과하고 open comment가 없다.
