# Supercanvas CLI 설계

중앙 엔진 기반 전역 CLI로 여러 canvas package를 생성·관리·업데이트·뷰잉한다.
확정된 결정은 "전역 CLI + package는 각 프로젝트 레포에 데이터로 + 머신 레벨 레지스트리"까지고,
아래 세부 설계는 제안 상태다. 구현하면서 확정되는 항목은 이 문서에 반영한다.

## 원칙

- engine 코드는 복사하지 않는다. CLI가 유일한 진입점이고 canvas package는 데이터만 가진다.
- 기존 `render.mjs` / `verify.mjs` / `context.mjs` / `update.mjs`를 재사용한다. CLI는
  서브커맨드 라우팅과 package 해석(resolution) 계층만 추가한다.
- package 루트의 `canvas.json`이 package 마커다. 별도 마커 파일을 만들지 않는다.

## 커맨드 표면 (제안)

```text
supercanvas new <dir> [--title t] [--template minimal]   package 스캐폴드 + 레지스트리 등록
supercanvas add [path] [--slug s]                        기존 package를 레지스트리에 등록
supercanvas update [target]                              render + verify (현 update.mjs)
supercanvas render [target]                              render만
supercanvas verify [target]                              검증만
supercanvas view [target]                                dist/canvas.html을 브라우저로 연다
supercanvas list                                         등록된 canvas 목록과 schemaVersion, 최근 render 상태
supercanvas remove <slug>                                레지스트리에서 제거 (package 파일은 유지)
supercanvas context --target <id> [target]               agent용 최소 source 해석 (현 context.mjs)
supercanvas migrate [target]                             schemaVersion 순차 업그레이드
```

`[target]` 해석 규칙: 인자가 없으면 cwd에서 위로 올라가며 `canvas.json`을 찾는다(git 방식).
경로면 그대로 쓰고, 그 외에는 레지스트리 slug로 조회한다.

## 레지스트리 (제안)

- 위치: `~/.supercanvas/registry.json` — `slug → { path, 등록 시각 }`의 머신 로컬 매핑.
- 경로는 머신마다 다르므로 레지스트리는 버전 관리 대상이 아니다. package 자체는 각 프로젝트
  레포가 버전 관리한다.
- self workspace store에 얹지 않는다. supercanvas는 self가 없는 환경에서도 독립 동작해야 한다.

## 배포 (제안)

- 이 레포에 `package.json`과 `bin/supercanvas.mjs`(서브커맨드 라우터)를 추가한다.
- 설치는 `git clone` 후 `npm link`, 또는 git URL로 `npm install -g`. 별도 빌드 없이 mjs 그대로 실행한다.

## schemaVersion 호환 (선행 조건)

엔진이 전역화되면 "엔진을 올렸더니 예전 canvas가 안 열린다"가 바로 생긴다. 그래서:

- CLI는 모든 커맨드에서 package의 `schemaVersion`을 먼저 확인하고, 엔진 지원 범위 밖이면
  render를 거부하며 `migrate`를 안내한다. 조용한 부분 실패보다 명시적 거부가 낫다.
- `migrate`는 버전별 순차 변환기(v2→v3→…)로 구현하고, 변환 후 `verify`를 자동 실행한다.
- 현재 구현: `protocol.mjs`의 `migrateManifest`/`migrateSidecar`(v1→v2)를 manifest와 sources
  사이드카 파일에 영구 반영한 뒤 `update`(render+verify)를 실행한다. 엔진보다 새 버전이면
  update/render/verify/context/view/add 전부에서 명시적으로 거부하고, v1이면 경고 후 진행한다.
- roadmap A 트랙(schema versioning·migration 전략)과 병행한다.

## 구현 단계

1. `package.json` + `bin/supercanvas.mjs` 라우터 — 기존 스크립트를 감싸 `update`/`render`/
   `verify`/`context`가 CLI로 동작하게 한다.
2. 레지스트리와 `new`/`add`/`list`/`view` — 스캐폴드는 `templates/minimal`을 복사한다.
3. schemaVersion 게이트와 `migrate` 골격.

## 열린 문제

- `view`가 단순히 파일을 여는 것으로 충분한지, 로컬 서버로 서빙하며 재렌더를 감지하는
  watch 모드가 필요한지.
- slug 네임스페이스: 프로젝트당 canvas가 여러 개일 때 `프로젝트/캔버스` 형태로 갈지.
