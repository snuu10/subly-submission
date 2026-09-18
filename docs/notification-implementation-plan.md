# Subly 결제일 알림 구현 계획

작성일: 2026-09-12

## 1. 목표

활성 구독의 다음 결제일을 기준으로 D-3, D-1 알림을 제공한다.

- 웹: 헤더의 종 아이콘에 읽지 않은 알림 수를 빨간 숫자 배지로 표시한다.
- 웹: 종 아이콘을 누르면 전체 알림 목록을 볼 수 있어야 한다.
- 앱: 앱이 종료되었거나 백그라운드에 있어도 D-3, D-1 푸시 알림을 받는다.
- 알림을 누르면 해당 구독 또는 알림함으로 이동한다.
- 웹과 앱은 동일한 알림 데이터와 읽음 상태를 사용한다.

제품 규칙은 [`rules/notifications.md`](./rules/notifications.md)를 따른다.

## 2. 구현 전 필수 확인

이 프로젝트는 Expo SDK 57을 사용한다. 코드를 작성하기 전에 반드시 아래 버전 고정 문서를 확인한다.

- Expo SDK 57 Notifications: https://docs.expo.dev/versions/v57.0.0/sdk/notifications/
- Expo Push 설정: https://docs.expo.dev/push-notifications/push-notifications-setup/
- Expo Push 발송 및 Receipt 처리: https://docs.expo.dev/push-notifications/sending-notifications/

현재 주요 버전:

- `expo`: `~57.0.15`
- `expo-router`: `~57.0.15`
- React Native: `0.86.2`
- Supabase JS: `^2.112.3`

SDK 57 권장 버전에 맞춰 `npx expo install expo-notifications`로 설치한다. Android 원격 푸시는 Expo Go가 아니라 development build 또는 배포 빌드에서 검증한다.

## 3. 현재 상태

- [`components/AppHeader.tsx`](../components/AppHeader.tsx)
  - 종 아이콘과 빨간 배지가 이미 있다.
  - 현재 배지는 `7일 이내 결제 예정 구독 수`를 표시한다.
  - 홈 화면에서만 종 아이콘을 눌렀을 때 결제 예정 탭으로 이동한다.
- [`lib/notifications.ts`](../lib/notifications.ts)
  - 권한 요청과 D-3/D-1 예약 함수가 경고 로그만 출력하는 스텁이다.
- [`stores/subscription-store.ts`](../stores/subscription-store.ts)
  - `anchor_date`를 기준으로 `next_payment_date`를 계산한다.
  - 지난 `next_payment_date` 갱신은 현재 클라이언트가 구독을 조회할 때 수행한다.
- [`app.json`](../app.json)
  - `expo-notifications` 플러그인과 Android FCM 설정이 없다.
- Supabase
  - 알림, 기기 토큰, 푸시 발송 결과를 저장하는 테이블이 없다.

## 4. 핵심 설계 결정

### 4.1 서버 원격 푸시를 사용한다

클라이언트 로컬 예약만으로 구현하지 않는다. Supabase Cron과 Edge Function이 알림을 생성하고 Expo Push Service를 통해 전송한다.

이유:

- 앱이 최근에 실행되지 않아도 알림을 보낼 수 있다.
- 웹에서 구독을 등록하거나 수정한 경우에도 앱 푸시에 반영된다.
- 여러 기기에서 동일한 계정을 사용할 수 있다.
- 웹 알림함과 푸시 발송 기록을 하나의 데이터로 관리할 수 있다.

기존 `lib/notifications.ts`는 로컬 알림 예약 함수가 아니라 권한 확인, 토큰 등록, 수신 및 클릭 처리 역할로 변경한다. 서버 푸시와 로컬 예약을 동시에 사용해 중복 알림이 발생하지 않게 한다.

### 4.2 결제일의 기준은 `anchor_date`다

`next_payment_date`가 오래된 상태일 수 있으므로 서버 알림 생성기는 단순히 해당 컬럼만 신뢰하지 않는다.

- 월간·연간: `anchor_date`와 `billing_cycle`로 다음 결제일을 서버에서 계산한다.
- 일회성: 미래의 `anchor_date`에 대해서만 한 번 D-3/D-1 알림을 생성한다.
- 비활성 구독은 제외한다.
- 날짜 계산과 발송 기준 시간대는 기본 `Asia/Seoul`이다.
- 월말 결제일과 윤년을 기존 앱 계산 규칙과 동일하게 처리한다.

### 4.3 중복 생성과 중복 발송을 DB에서 차단한다

다음 조합에 고유 제약을 둔다.

```text
user_id + subscription_id + payment_date + reminder_offset
```

Cron 또는 Edge Function이 재실행되어도 같은 결제 건의 D-3 또는 D-1 알림은 한 번만 생성되어야 한다.

## 5. 데이터베이스 계획

### 5.1 `notifications`

권장 필드:

```text
id                  uuid primary key
user_id             uuid not null
subscription_id     uuid null
kind                text not null          -- payment_due
payment_date        date not null
reminder_offset     integer not null       -- 3 또는 1
title               text not null
body                text not null
target_path         text null
read_at             timestamptz null
created_at          timestamptz not null
push_status         text not null          -- pending/sent/partial/failed/skipped
push_sent_at        timestamptz null
```

요구사항:

- 사용자별 최신순 조회 인덱스
- 사용자별 `read_at is null` 조회 인덱스
- 위의 중복 방지 고유 제약
- 구독 삭제 후에도 과거 알림을 유지할지 결정할 수 있도록 `subscription_id`는 nullable을 권장한다.
- 사용자는 자신의 알림만 조회하고 `read_at`만 변경할 수 있도록 RLS를 적용한다.

### 5.2 `notification_devices`

권장 필드:

```text
id                  uuid primary key
user_id             uuid not null
expo_push_token     text not null unique
platform            text not null          -- android/ios
device_key          text null
enabled             boolean not null
last_seen_at        timestamptz not null
created_at          timestamptz not null
updated_at          timestamptz not null
```

요구사항:

- 한 사용자에게 여러 기기를 허용한다.
- 로그인 또는 앱 활성화 시 토큰을 upsert한다.
- 로그아웃 시 현재 기기의 토큰을 비활성화한다.
- Expo Receipt가 `DeviceNotRegistered`를 반환하면 해당 토큰을 비활성화한다.
- 사용자는 자기 기기만 등록·비활성화할 수 있도록 RLS를 적용한다.

### 5.3 `notification_push_deliveries`

기기별 발송과 Receipt 추적이 필요하므로 별도 테이블을 권장한다.

```text
id                  uuid primary key
notification_id     uuid not null
device_id           uuid not null
status              text not null          -- pending/ticket_ok/delivered/error
expo_ticket_id      text null
error_code          text null
error_message       text null
sent_at             timestamptz null
checked_at          timestamptz null
```

`notification_id + device_id`에 고유 제약을 둔다.

### 5.4 알림 설정

초기 버전에서는 D-3/D-1과 오전 9시를 고정해도 된다. 사용자 설정을 바로 제공한다면 `notification_preferences` 테이블에 다음 값을 둔다.

- `payment_reminders_enabled`
- `timezone`
- `delivery_hour`

## 6. 서버 작업 계획

### 6.1 알림 생성 Edge Function

예시 이름: `generate-payment-notifications`

동작:

1. 실행 시각을 KST 날짜로 변환한다.
2. 활성 구독 중 오늘이 D-3 또는 D-1인 결제 건을 찾는다.
3. 고유 키를 기준으로 `notifications`를 upsert한다.
4. 활성 기기 토큰마다 delivery 행을 생성한다.
5. Expo Push Service로 최대 100건씩 나누어 전송한다.
6. ticket ID와 즉시 오류를 저장한다.
7. 일부 기기만 실패한 경우 알림의 `push_status`를 `partial`로 기록한다.

기본 발송 시간은 `Asia/Seoul` 오전 9시로 한다. Cron은 누락 복구를 위해 매시간 실행하되, 해당 날짜·시간대의 발송 대상만 처리하고 고유 제약으로 중복을 차단한다.

### 6.2 Receipt 확인 Edge Function

예시 이름: `check-notification-receipts`

- ticket 생성 후 약 15분이 지난 delivery를 조회한다.
- Expo Push Receipt를 최대 1,000개씩 확인한다.
- 성공·실패 결과를 저장한다.
- `DeviceNotRegistered` 기기는 비활성화한다.
- 429와 5xx 등 일시 오류는 제한된 횟수만 지수 백오프로 재시도한다.
- 서버 로그에 토큰 전체를 노출하지 않는다.

### 6.3 알림 payload

```json
{
  "title": "내일 넷플릭스 결제 예정",
  "body": "9월 15일 · 17,000원 결제 예정",
  "data": {
    "kind": "payment_due",
    "notificationId": "...",
    "subscriptionId": "...",
    "targetPath": "/subscription/..."
  }
}
```

문구 규칙:

- D-3 제목: `3일 후 {서비스명} 결제 예정`
- D-1 제목: `내일 {서비스명} 결제 예정`
- 본문: `{M월 d일} · {금액}원 결제 예정`
- 금액은 `ko-KR` 천 단위 구분 형식을 사용한다.

## 7. 웹 구현 계획

### 7.1 알림 store

예시 파일: `stores/notification-store.ts`

상태와 작업:

- 알림 목록
- 읽지 않은 개수
- 로딩 및 오류
- 목록 조회
- 단일 알림 읽음 처리
- 모두 읽음 처리
- Realtime 구독과 해제

로그인 직후 초기 조회하고 `notifications` 테이블의 INSERT/UPDATE를 Realtime으로 반영한다.

### 7.2 헤더 배지

[`components/AppHeader.tsx`](../components/AppHeader.tsx)를 다음과 같이 변경한다.

- `getUpcomingSubscriptions(..., 7).length` 사용을 제거한다.
- notification store의 읽지 않은 알림 수를 사용한다.
- 1~99는 숫자로, 100 이상은 `99+`로 표시한다.
- 알림이 없으면 배지를 숨긴다.
- 모든 화면에서 종 아이콘의 기본 클릭 동작이 알림함으로 이동하게 한다.
- `accessibilityLabel`에 읽지 않은 개수를 포함한다.

### 7.3 알림함 화면

예시 경로: `app/notifications.tsx`

구성:

- 제목 `알림`
- 읽지 않은 알림이 있을 때 `모두 읽음`
- 최신순 목록
- 읽지 않음 항목을 시각적으로 구분
- 알림 제목, 간결한 본문, 상대 시각 또는 생성 날짜
- 알림 클릭 시 읽음 처리 후 해당 구독 상세로 이동
- 연결된 구독이 삭제되었으면 알림만 읽음 처리하고 안전하게 알림함에 머문다.
- 빈 상태: `새로운 알림이 없어요`
- 초기 로딩, 재시도 가능한 오류 상태

웹 요구사항이지만 Expo Router 공용 화면으로 만들면 앱의 푸시 도착 지점으로도 재사용할 수 있다.

## 8. 앱 푸시 구현 계획

### 8.1 네이티브 설정

- `expo-notifications` 설치
- `app.json`에 config plugin 추가
- Android용 흰색 단색 투명 알림 아이콘 준비
- 알림 색상은 Subly primary color 사용
- Android 채널 ID 예시: `payment-reminders`
- 채널 표시명: `결제 예정 알림`
- Android FCM v1 서비스 계정 키를 EAS Credentials에 등록
- `google-services.json`을 연결하고 비밀 서비스 계정 JSON은 저장소에 커밋하지 않는다.
- EAS `projectId`가 없으면 프로젝트 설정을 완료한다.

### 8.2 권한과 토큰 등록

- Android 13 권한 창이 정상 표시되도록 알림 채널을 먼저 생성한다.
- 앱 첫 실행 즉시 권한을 요청하지 않는다.
- 로그인 후 알림의 이점을 설명하는 UI에서 사용자가 허용을 선택했을 때 요청한다.
- 거절했거나 다시 물을 수 없는 상태라면 OS 설정 이동 안내를 제공한다.
- `getExpoPushTokenAsync({ projectId })`로 토큰을 얻어 Supabase에 upsert한다.
- push token 변경 리스너를 등록한다.
- 실제 기기 또는 지원되는 시뮬레이터에서 검증한다.

### 8.3 수신과 이동

- 앱이 포그라운드일 때 배너를 보여줄지 notification handler에서 명시한다.
- 사용자가 푸시를 누르면 payload의 `targetPath`를 검증한 뒤 Expo Router로 이동한다.
- 앱이 종료된 상태에서 열린 경우와 실행 중인 경우를 모두 처리한다.
- 인증 복원 전에 푸시로 실행되면 세션 초기화가 끝난 뒤 이동한다.
- 잘못되거나 오래된 경로는 알림함으로 대체한다.
- 읽지 않은 알림 수와 앱 아이콘 배지를 동기화한다.

## 9. 구독 변경과의 정합성

- 추가: 서버가 다음 Cron 실행에서 새 결제일을 반영한다.
- 수정: 생성 전이면 새 결제일만 대상이 된다.
- 삭제 또는 비활성화: 아직 생성되지 않은 알림은 만들지 않는다.
- 이미 생성된 미래 알림: 발송 직전 구독 상태와 결제일을 다시 검증하고, 유효하지 않으면 `skipped` 처리한다.
- 결제 주기가 지난 뒤 다음 결제일 계산은 서버와 클라이언트가 동일해야 한다.
- Realtime으로 구독이 변경되어도 클라이언트에서 별도 로컬 알림을 예약하지 않는다.

## 10. 테스트 계획

### 날짜 계산

- D-3와 D-1에 정확히 한 번씩 생성
- 당일 D-Day에는 생성하지 않음
- 월말 29·30·31일 결제
- 2월과 윤년 연간 결제
- KST/UTC 경계에서 날짜가 하루 밀리지 않음
- 미래 일회성 결제와 지난 일회성 결제

### 데이터 정합성

- 같은 함수가 반복 실행되어도 중복 행과 중복 발송이 없음
- 삭제·비활성·결제일 변경 후 오래된 알림이 발송되지 않음
- 다른 사용자의 알림과 기기 토큰에 접근할 수 없음
- 여러 기기에 각각 한 번 발송
- 로그아웃한 기기는 발송 대상에서 제외

### 웹

- 배지가 읽지 않은 알림 수와 일치
- `99+` 표시
- 단일 읽음 및 모두 읽음이 즉시 반영
- 새 알림이 Realtime으로 표시
- 알림 클릭 후 올바른 구독으로 이동
- 삭제된 구독을 참조하는 알림도 오류 없이 처리

### 앱

- Android 권한 허용·거절·다시 묻기 불가 상태
- 포그라운드·백그라운드·종료 상태 수신
- 푸시 클릭 딥링크
- 잘못된 payload fallback
- FCM/EAS development build 실제 기기 수신
- Expo Ticket과 Receipt 오류 처리

## 11. 권장 구현 순서

1. DB 마이그레이션, 인덱스, RLS, 중복 방지 제약
2. 서버 결제일 계산 함수와 단위 테스트
3. 알림 생성 Edge Function과 Cron
4. 웹 notification store, Realtime, 알림함
5. 헤더의 읽지 않은 알림 배지와 공통 이동 동작
6. Expo Notifications 네이티브 설정
7. 앱 권한 요청, 토큰 등록, 로그아웃 비활성화
8. 서버 Expo Push 발송
9. Receipt 확인과 만료 토큰 정리
10. 푸시 클릭 딥링크와 앱 아이콘 배지
11. Android development build 통합 테스트
12. `docs/SPEC.md`의 알림 항목을 실제 구현 상태에 맞게 갱신

## 12. 완료 조건

- 웹의 모든 주요 화면에서 종 아이콘을 누르면 알림함이 열린다.
- 빨간 배지는 읽지 않은 알림 수를 정확히 표시한다.
- 알림함에서 단일 읽음과 모두 읽음이 동작한다.
- 활성 구독은 결제일 D-3와 D-1에만 알림이 한 번씩 생성된다.
- 앱이 종료된 상태에서도 실제 Android 기기에서 푸시가 수신된다.
- 푸시를 누르면 연결된 구독 상세 또는 알림함으로 이동한다.
- 구독 수정·삭제·비활성화로 인해 잘못된 푸시가 발송되지 않는다.
- 중복 Cron 실행, Edge Function 재시도, 여러 앱 세션에서도 중복 알림이 없다.
- RLS, 토큰 비활성화, Ticket/Receipt 오류 처리가 검증된다.
- TypeScript 검사와 관련 테스트가 통과한다.

## 13. 구현 시 주의사항

- 사용자의 요청 없이 알림 종류를 미사용 구독 리마인드 등으로 확장하지 않는다.
- 서비스 역할 키, FCM 서비스 계정 키, Expo 액세스 토큰을 클라이언트나 Git에 넣지 않는다.
- Expo Push Ticket의 성공은 사용자 기기 전달 성공이 아니므로 Receipt까지 확인한다.
- Android 알림 채널 속성은 채널 생성 후 일부 변경이 제한되므로 ID와 중요도를 초기에 확정한다.
- 기존 사용자의 unrelated 변경 사항을 덮어쓰지 않는다.
- 새 공통 제품 규칙이 생기면 `docs/rules/`와 `docs/rules/README.md`에 함께 기록한다.
