# AI 비서 버그 수정 — 완료 (2026-09-17)

> 배포까지 완료됨. 아래는 진행 중 겪은 문제와 해결 과정 기록.

## 버그 내용
사용자가 넷플릭스 중복 구독 등록 중 "별도 구독"을 선택했는데, AI가 엉뚱하게 "진행"이라는 이름으로
구독을 등록한 버그. 스크린샷으로 재현 확인됨.

## 원인
`supabase/functions/assistant-turn/index.ts`의 `handleTurn` 함수 안, `pendingReady` catch-all 조건이
`awaitingDuplicate`/`awaitingAccount` 상태를 배제하지 않고 있었음. 같은 파일의 다른 유사 분기 3곳은
전부 이 배제 조건이 있는데 이 조건만 빠져 있었음.

`classifyConfirmationDecision("별도 구독")`이 명확한 confirm/reject가 아니라 "unclear"로 판정되는데,
이 catch-all이 그걸 가로채서 세션의 등록 초안(이름 포함)을 날려버리고 "아직 확인할 작업이 있어요"로
엉뚱하게 응답 → 다음 턴에서 구독명이 유실되어 "진행"(버튼 텍스트)이 그대로 이름으로 등록됨.

## 완료된 작업
1. **로컬 코드 수정 완료** — `supabase/functions/assistant-turn/index.ts` 약 1067번째 줄:
   ```ts
   if (pendingReady && !awaitingDuplicate && !awaitingAccount && (confirmation === "unrelated" || confirmation === "unclear")) {
   ```
   (기존에는 `!awaitingDuplicate && !awaitingAccount` 부분이 없었음)
2. **회귀 테스트 추가 완료** — `supabase/functions/assistant-turn/gemini-intent.test.ts`에
   "별도 구독" 케이스를 검증하는 테스트 추가.
3. **로컬 테스트 통과 확인 완료** — `deno test` 실행 결과 85개 테스트 전부 통과 (기존 84개 + 신규 1개).

## 원격 배포 — 겪었던 문제와 해결

로컬 수정을 실제 운영 중인 Supabase 프로젝트(`ikbogbhugowdvrcxggax`)의 `assistant-turn`
엣지 함수에 반영하는 과정에서 두 가지 문제를 겪었고, 최종적으로 해결해 배포까지 완료함.

### 문제 1: MCP 툴로 직접 배포 시도 → 실패
`mcp__claude_ai_Supabase__deploy_edge_function` MCP 툴로 파일 내용을 직접 실어 배포를
시도했는데, 이 툴은 매 호출마다 의존성 파일 전체(`index.ts`, `claude-query.ts`,
`explain.ts`, `gemini-intent.ts`, `queries.ts`, `_shared/claude.ts`)를 통째로 다시 보내야
하는데(이전 호출 내용이 누적되지 않고 매번 덮어써짐), 반복적으로 일부 파일을 빠뜨려서
"Module not found" 오류로 계속 실패함.

### 문제 2: Supabase CLI 기본 배포(Docker 번들링) → 행(hang)
`supabase link --project-ref ikbogbhugowdvrcxggax`까지는 성공했으나, 기본
`supabase functions deploy assistant-turn` 실행 시 "Bundling Function: assistant-turn"
단계에서 멈춘 채 CPU 사용량도 거의 없고 네트워크 연결도 전혀 없는 상태로 두 번 재시도해도
동일하게 멈춤. 로컬 Docker 기반 번들링 단계가 이 환경에서 정상 동작하지 않는 것으로 보임
(정확한 근본 원인은 특정하지 못함 — Docker 자체는 `docker info`상 정상 실행 중이었음).

### 해결: `--use-api` 플래그
`supabase functions deploy assistant-turn --use-api --debug` 로 재시도해서 성공함.
`--use-api`는 로컬 Docker 번들링 대신 서버사이드(Supabase API) 번들링을 사용하는 옵션 —
이 환경에서는 이 방식을 써야 함. 배포 완료 응답:
```
{"project_ref":"ikbogbhugowdvrcxggax","functions":["assistant-turn"],"message":"Deployed Functions."}
```

**앞으로 이 프로젝트에서 `assistant-turn`(또는 다른 함수)을 CLI로 배포할 때는 항상
`--use-api` 플래그를 붙일 것.**

## 완료된 후속 작업
- [x] 실제 배포 완료 확인.
- [x] `git add` → 커밋 (이 커밋).
- [ ] 실제 시나리오(넷플릭스 중복 등록 → "별도 구독" 선택)로 프로덕션 재현 테스트는 아직
      안 함 — 필요시 다음에 진행.

## 관련 파일
- 수정된 파일: `supabase/functions/assistant-turn/index.ts`
- 추가된 테스트: `supabase/functions/assistant-turn/gemini-intent.test.ts`
- 이 문서: `docs/assistant-turn-bugfix-status.md`
