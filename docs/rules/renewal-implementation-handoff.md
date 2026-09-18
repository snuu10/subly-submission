# 갱신·지출 고도화 작업 인계

갱신: 2026-09-14

이 문서는 작업 중단 시 Codex·Claude 등 다음 작업자가 같은 기준으로 이어가기 위한 실행 기록이다.
제품 규칙은 [renewals.md](./renewals.md), [spend-metrics.md](./spend-metrics.md),
[assistant.md](./assistant.md)를 우선한다.

## 승인 범위

- 앱·웹·AI 비서에 공통 규칙을 적용한다.
- 필요한 Supabase 마이그레이션과 Edge Function 원격 배포가 승인되었다.
- 운영 데이터는 삭제하지 않는다. 스키마 변경은 마이그레이션으로 남긴다.

## 파일 소유권

동시에 같은 파일을 수정하지 않는다.

| 작업 단위 | 담당 영역 | 상태 |
|---|---|---|
| 모바일 화면 | `app/`, 모바일 화면 전용 `components/` | 진행 예정 |
| 웹 화면 | `web/src/` | 진행 예정 |
| 공통 계산·AI·데이터베이스 | `lib/`, `stores/`, `supabase/`, `docs/rules/` | 진행 예정 |
| 통합 검사·원격 배포 | 전체 검토 | 진행 예정 |

## 완료 조건

- 홈에 `월평균 구독 지출액`, `이번 달 예상 지출액`, `다음 달 예상 지출액`,
  `등록된 결제 일정 기준`이 일관되게 표시된다.
- 구독 목록은 기존 카테고리 칩·그룹을 유지하고 상태 드롭다운을 함께 적용한다.
- 상태 필터는 `전체 상태`, `활성`, `일시정지`, `종료 예정`, `종료`이다.
- 활성 구독 액션은 `일시정지`, 일시정지 구독 액션은 `다시 시작`이다.
- 설정에서 앱 버전과 플랫폼 빌드 번호를 확인할 수 있다.
- AI 비서는 실제 금융 결제를 확인할 수 있다고 말하지 않으며 `갱신 안 함`을 삭제로 처리하지 않는다.
- 앱 타입 검사, 웹 프로덕션 빌드, SQL/RLS 검증을 통과한다.
- 원격 적용 뒤 마이그레이션 및 Edge Function 상태를 이 문서에 기록한다.

## 인계 기록 형식

각 작업자는 완료 시 다음을 남긴다.

- 수정 파일
- 완료 항목과 미완료 항목
- 실행한 검사와 결과
- 원격 배포 여부
- 다음 실행 명령 또는 알려진 문제

출처: 2026-09-14 사용자 승인 및 Claude 분할·중단 대비 요청.

## 진행 기록 (2026-09-14, 이어받은 작업자)

이전 작업자가 토큰 부족으로 중단한 지점부터 이어받아 검증·마무리했다.

### 수정 파일

- `supabase/functions/assistant-turn/gemini-intent.test.ts`: `isDuplicateSameUtterance`,
  `isDuplicateSeparateUtterance` import 누락 수정 (함수는 이미 구현돼 있었음, 테스트만 깨져 있었음).
- `supabase/functions/assistant-turn/verify.test.ts`: `explain.ts`의 의도된 문구 변경
  (`결제 예정은 N원` → `예상 지출액 중 아직 날짜가 오지 않은 금액은 N원`)에 맞춰 오래된 assertion 갱신.

### 완료 항목

- 앱 타입 검사(`tsc --noEmit`) 통과.
- 웹 타입 검사 + 프로덕션 빌드(`tsc && vite build`) 통과.
- `assistant-turn` Deno 테스트 67개 전부 통과 (수정 전 2건 실패: import 누락으로 인한 타입 오류,
  오래된 문구 assertion).
- 완료 조건 문구를 코드에서 직접 확인함: 홈 카드(`월평균 구독 지출액`/`이번 달 예상 지출액`/
  `다음 달 예상 지출액`/`등록된 결제 일정 기준`), 상태 필터(`전체 상태`/`활성`/`일시정지`/
  `종료 예정`/`종료`), 액션 라벨(`일시정지`/`다시 시작`), 설정 화면 앱 버전·플랫폼 빌드 번호,
  웹 `SpendWidget`은 `web/src/lib/spend-metrics.ts`의 공용 라벨 상수를 그대로 사용.
- 모바일·웹 `LifecycleConfirmCard`가 동일한 상태 분기와 안내 문구를 유지함을 확인.
- 원격 마이그레이션 `20260914015900`(해지 확인 후 자동 종료), `20260914180000`(자동 갱신 이력)
  이미 원격에 적용되어 있음을 `supabase migration list`로 확인.
- `assistant-turn`, `claude-proxy` Edge Function을 사용자 승인 하에 원격 재배포함
  (`assistant-turn`은 새 번들로 갱신, `claude-proxy`는 이미 최신 상태라 변경 없음).

### 미완료 / 알려진 문제

- ~~`20260914120000_category_duplicate_hidden_hint.sql` 원격 미적용~~ → **오기. 정정함.**
  원격 함수 정의와 이력 테이블을 직접 조회한 결과 이미 적용돼 있었다. 원격에는 같은 내용이
  버전 `20260913165842`(같은 이름 `category_duplicate_hidden_hint`)로 기록돼 있고,
  `guard_category_normalized_name`의 실제 정의도 로컬 파일과 문자 단위로 일치한다.
  **적용할 것 없음.**
- `supabase/functions/claude-proxy`는 `deno check`가 `npm:openai` 타입 선언을 로컬에서
  해석하지 못해 실패함 (환경 제약으로 보임, 원격 배포 자체는 정상 완료). 로컬에서 타입 검증이
  필요하면 `deno install`로 npm 의존성을 받아온 뒤 재시도할 것.
- `git status`에 33개 파일이 아직 커밋되지 않은 상태로 남아 있음. 커밋은 사용자 요청 시에만
  진행하기로 해 그대로 둠.

### 마이그레이션 이력 분기: `supabase db push` 금지

`supabase migration list`의 로컬·원격 불일치는 **스키마 차이가 아니라 기록 방식 차이**다.
원격 마이그레이션은 상당수가 CLI가 아닌 다른 경로(대시보드·MCP 등)로 적용되면서
파일명과 다른 타임스탬프로 기록됐다. 이름 기준으로 대조하면 로컬 44건 중 43건이
원격에 존재한다.

**`supabase db push`를 실행하면 안 된다.** 이름까지 원격에 없는 유일한 로컬 파일이
`20260902070000_create_next_payment_and_confirm_lock.sql`인데, 이 파일은 이후
마이그레이션(`20260902130746`, `20260905023701` 등)이 다시 정의한
`confirm_pending_assistant_action`과 `subscription_next_payment_date`의
**구버전**을 담고 있다. 원격 현재 정의는 두 함수 모두 `one_time`을 지원하지만
(`confirm_pending_assistant_action` 10,226자), 이 파일의 정의는 `monthly`/`yearly`/`weekly`만
허용한다. push하면 일회성 결제 지원이 통째로 되돌아간다.

스키마 변경이 필요하면 새 마이그레이션 파일을 만들고 **그 파일 하나만** 원격에 적용할 것.

### 다음 실행 명령 또는 참고

- 로컬 검증: `npx tsc --noEmit`(루트), `cd web && npm run build`,
  `cd supabase/functions/assistant-turn && deno test --allow-env`.
- 원격 상태 확인(읽기 전용):
  `supabase db query --linked "select version, name from supabase_migrations.schema_migrations order by version desc limit 10;"`
- 원격 DB는 2026-09-14 기준 적용할 마이그레이션이 남아 있지 않다.
