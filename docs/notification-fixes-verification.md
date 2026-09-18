# 알림 수정 및 검증 결과

<!-- ChatGPT 수정: 이번 알림 수정의 범위, 재현 테스트, 배포 시 주의사항을 기록한다. -->

작성: 2026-09-13. 이번 작업은 로컬 코드와 마이그레이션 작성까지이며 원격 DB/함수/앱에는 배포하지 않았다.
수정 로직에는 `ChatGPT 수정:` 주석을 남겼다. 기존 사용자 변경과 Firebase 설정/비밀 키는 유지했다.

## 수정한 세 가지

### 1. 푸시 실패 재시도

- 새 알림 생성과 발송 큐 처리를 분리했다. 새로 생성된 알림이 0개여도 기존 알림을 처리한다.
- 당일 D-3/D-1 알림을 활성 기기와 다시 연결하므로, 알림 생성 이후 등록한 기기도 처리한다.
- DB의 고유 제약과 `FOR UPDATE SKIP LOCKED`로 기기별 작업을 중복 선점하지 않는다.
- `pending/retry → claimed → sending → ticket_ok/retry/error/unknown`으로 전송 단계를 구분한다.
- 전송 전 선점이 10분 이상 방치되면 재시도한다. 전송 중 상태에서 종료됐거나 네트워크 응답을 잃었으면 `unknown`으로 남기고 자동 재발송하지 않는다.
- HTTP 429/5xx, 명확한 `MessageRateExceeded` 응답은 최대 5회 시도하며 5·10·20·40분 간격으로 재시도한다.
- 성공 티켓/전달 성공은 재발송하지 않는다. 잘못된 토큰은 발송 당시 소유자/토큰이 여전히 일치할 때만 비활성화한다.
- 구독 해지/삭제/결제일 변경, 기기 소유권 변경을 전송 직전에 다시 검사한다. 지난 알림은 소급 발송하지 않는다.
- 기존 Cron 이름은 유지하고 실행 간격만 5분으로 변경한다. KST 오전 9시 전에는 발송하지 않는다.
- 회당 최대 100개 기기 작업을 처리한다. 대기열이 많으면 이후 실행에서 이어서 처리한다.
- Expo 티켓 수락은 실제 휴대전화 표시를 보장하지 않는다. 전송 여부 불명확 상태에서 중복 방지와 자동 복구를 동시에 완전히 보장할 수는 없다.

### 2. 과거 푸시 응답 초기화

- 콜드 스타트와 실행 중 알림 탭을 하나의 직렬 처리기로 통합했다.
- 세션 준비 후 처리하며, 처리 중 계정이 바뀌면 이전 계정의 화면으로 이동하지 않는다.
- 요청 식별자 및 마지막 처리 식별자를 이용해 중복 이벤트/재실행을 방지한다.
- 처리한 native 응답은 `clearLastNotificationResponseAsync`로 비운다. 더 최근의 다른 응답은 지우지 않는다.
- payload의 임의 경로 대신 현재 계정 소유의 DB 알림/구독을 조회해 이동한다. 삭제됐거나 잘못된 대상은 알림함으로 이동한다.
- 목록 밖의 알림도 탭하면 읽음 처리한다. 네트워크 실패 시 다음 앱 활성화에서 native 응답을 다시 확인한다.

### 3. 전체 미확인 배지 수

- 모바일/웹 모두 최근 50개 목록과 별개로 `count: 'exact', head: true` 집계를 사용한다.
- 전체 읽음은 목록 밖의 미확인 알림도 포함한다.
- DB 읽음 처리 성공 후 재조회한다. 실패 시 성공한 것처럼 숫자를 줄이지 않는다.
- 늦게 도착한 조회가 최신 조회나 로그아웃 후 상태를 덮어쓰지 못하게 했다.
- 재연결/앱 활성화/웹 포커스 복귀 시 재조회한다. 계정 전환 시 이전 목록과 배지를 초기화한다.
- OS 배지는 마지막 동기화/푸시 발송 시점의 서버 집계값이다. 앱이 종료되거나 오프라인인 동안 다른 기기의 읽음 변경을 즉시 반영하는 silent push는 이번 범위에 포함하지 않았다.
- 알림 목록 자체는 기존처럼 최대 50개다. 전체 과거 목록 페이지네이션은 이번 배지 오류 수정과 별개다.

## 검증

- `node --test scripts/test-notifications.mjs`: 외부 전송 없이 타입/전송 분류/생성기/날짜/배지/탭 처리 테스트.
- `node scripts/test-notifications.mjs --database`: 전용 임시 Docker PostgreSQL까지 포함해 **14개 테스트 통과**.
- DB 테스트: 마이그레이션 실행, 늦은 토큰 등록, 재시도 지연/횟수, 선점 만료, 성공 티켓 중복 방지, 잘못된 claim 무시, 기기 소유권 변경, 비활성 구독 제외, RLS, 서비스 전용 RPC 권한.
- 서로 다른 실제 PostgreSQL 연결의 동시 선점 결과가 1개/0개임을 확인했다.
- 75개 미확인/50개 목록, 첫 50개가 모두 읽음인 경우의 전체 읽음, 조회 응답 역전, 로그아웃 도중 조회, 초기 응답/실시간 응답 중복을 검증했다.
- Edge Function은 설치된 Supabase 클라이언트 타입으로 TypeScript 검사했다. 실제 Supabase Edge Runtime에서 원격 실행한 검증은 아니다.
- 웹 `npm run build`: 통과. 기존 번들 크기 경고는 남아 있다.
- 루트 `npx tsc --noEmit`: 기존 `app/payment-methods.tsx:927`의 `StyleSheet.absoluteFillObject` 오류 1개가 남는다. 이번 알림 수정 파일에서는 오류가 없다.
- 실기기 Android/iOS 푸시 도착·권한·아이콘 배지 표시는 배포 및 새 빌드 후 확인해야 한다.

DB 테스트는 `subly-notification-review-test`라는 전용 임시 컨테이너만 사용한다.
실행 시 테스트 스키마를 만들고 롤백/정리하므로 기존 개발 DB를 이 이름으로 지정해서는 안 된다.
이번 검증에 사용한 컨테이너는 검증 후 제거한다.

## 배포 순서 — 아직 실행하지 않음

1. 해당 개발 프로젝트인지 확인하고 알림 Cron 두 개를 잠시 중지한다. 기존 발송 실행이 끝난 뒤 진행한다.
2. 기존 알림 테이블 마이그레이션 뒤에 신규 `20260912160201_notification_delivery_retries.sql`을 적용한다.
3. `generate-payment-notifications`, `check-notification-receipts`를 함께 배포한다. 생성기의 공유 파일 `_shared/notification-push.ts`도 포함한다.
4. JWT 검증을 유지하고 기존 Vault 인증 설정을 유지한다. 새 클라이언트 비밀 키를 추가하지 않는다.
5. Cron을 재개한다. 기존 generator job 이름에는 hourly가 남지만 스케줄은 5분 간격이다.
6. 웹 배포 및 앱 배포/빌드 후 본인 테스트 계정으로 실제 알림을 확인한다.
7. `unknown`, `error`, 장시간 대기 작업을 살핀다. `unknown`을 무조건 retry로 바꾸면 이미 도착한 푸시가 중복될 수 있다.

신규 SQL에 의존하는 함수를 먼저 배포하면 RPC가 없어 실패한다. 함수만 예전 버전으로 되돌린 뒤 Cron을 실행하는 것도 새 큐 상태와 충돌할 수 있으므로 배포 중에는 Cron을 중지한다.

## 참고

- [Expo SDK 57 Notifications](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/)
- [Expo 전송 오류·티켓·영수증](https://docs.expo.dev/push-notifications/sending-notifications/)
- [Supabase 정확한 개수 조회](https://supabase.com/docs/reference/javascript/select)
- [Supabase Cron 변경](https://supabase.com/docs/guides/cron/quickstart)

Supabase/Postgres 스킬의 큐 선점 및 부분 인덱스 지침을 적용했으며, 운영 접근 대신 격리 DB에서 검증했다.
