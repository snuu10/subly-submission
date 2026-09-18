# 웹: 영수증 사진 첨부 + 알림 위젯 구현 완료 보고

작성: 2026-09-15
계획 원본: [docs/web-receipt-and-notification-widget-plan.md](./web-receipt-and-notification-widget-plan.md)

## Part A. 웹 영수증 사진 첨부 (`web/src/components/AssistantPanel.tsx`)

앱(`app/chat.tsx`) 커밋 `b7ae208`, `6f20082`의 로직을 그대로 이식했다. 서버 변경 없음 — 이미 배포된 `claude-proxy`/`assistant-turn`을 그대로 호출.

### 재사용한 기존 자산

- `web/src/lib/claude.ts`의 `invokeClaude` — 앱과 시그니처 동일, 그대로 사용.
- `web/src/lib/image.ts`의 `readReceiptFile`/`ReceiptImage` — 앱의 `pickReceiptImage`에 해당하는 웹 버전이 이미 `ReceiptOcrModal.tsx`에서 쓰이고 있어 그대로 재사용.
- `web/src/lib/duplicate-account.ts`의 `duplicateAccountIssue`/`duplicateAccountMessage` — 앱과 동일 로직이 웹에도 이미 존재, import해서 사용.
- `web/src/lib/data.ts`의 `createSubscription(input, existing)` — 두 번째 인자로 `existing` 구독 배열을 받는 시그니처 차이에 맞춰 호출부 조정.

### 새로 만든 것

1. **사진 첨부 UI**: composer 폼에 숨겨진 `<input type="file">` + "사진" 버튼 + 첨부 미리보기 스트립(썸네일·파일명·취소 버튼). `pendingImage`/`pendingImageRef` state로 관리, `applyAttachedFile`이 `readReceiptFile`을 호출.
2. **전송 분기**: `send()` 안에서 `image = pendingImageRef.current`가 있으면 `invokeClaude({mode:'chat', ...})`, 없으면 기존 `invokeAssistantTurn`을 호출. 응답 타입은 `image ? null : (response as AssistantTurnResponse)`로 `turn` 변수를 만들어, 텍스트 전용 필드(`pending_action_id`, `intent`, `cancel_guide` 등)는 `turn?.` 로, 공통 필드(`extract`, `action`, `candidate_ids` 등)는 기존처럼 `response.`로 접근하도록 정리.
3. **`ChatItem` 필드 추가**: `imageUri`/`imageName`(사용자 말풍선에 첨부 사진 표시용), `fromReceiptImage`, `awaitingAccount`.
4. **`receiptNameOverlap` 판정 + 3버튼 카드 전환**: `candidatesFromIds` 공용 추출, 이름이 겹치면 `duplicateCreate`/`candidates`/`pendingAction='update'`/`pendingExtract`/`fromReceiptImage`를 채워 기존 웹 duplicateCreate 카드(변경/별도로 추가/삭제/그대로 두기)를 그대로 띄운다.
5. **"별도로 추가" 로컬 처리**: `item.fromReceiptImage && item.pendingExtract`이면 `toParsedSubscription`으로 즉시 `item.extract`를 채워 등록 확인 카드로 전환(서버 왕복 없음). 그 외(텍스트 경로)는 기존처럼 `send('별도 구독')`.
6. **"계정 필요" → 채팅 답장 자동 등록**: `handleRegister`의 직접 저장 분기에서 `createSubscription` 호출 전 `duplicateAccountIssue`로 미리 검사, 문제 있으면 `awaitingAccount: true` + 안내 메시지. `send()` 맨 앞에 `pendingAccountItem` 가로채기 추가(취소/회피/계정 답장/`taken` 처리) — `looksLikeAccountDodge`/`looksLikeAccountCancel` 헬퍼를 모듈 레벨에 복제.
7. **영수증 한 장씩 제약 + 채팅으로 취소**: `send()` 맨 앞, `pendingAccountItem` 가로채기보다 먼저 `openReceiptItem` 검사 — "취소" 답장이면 해당 카드를 `dismissed`로 닫고, 새 이미지를 보내려 하면 차단 안내.
8. **웹 전용 조정**: 텍스트 duplicateCreate 카드에는 원래 "삭제"(목록에서 삭제) 버튼이 있는데, 이는 서버 세션(`awaiting_duplicate`)을 전제로 하고 영수증 경로엔 그 세션이 없어 그대로 두면 깨진다. `item.fromReceiptImage`일 때만 "삭제" 버튼을 숨기고, 텍스트 경로의 기존 4버튼 동작은 그대로 유지했다(계획서에 명시되지 않은 웹 전용 보강).
9. 앱과 달리 웹에는 토스트(`notify`) 유틸이 없어, 앱의 `notify(...)` 호출은 모두 채팅 말풍선(assistant 메시지)으로 대체했다.

## Part B. 알림 위젯 (`web/src/components/widgets/NotificationWidget.tsx`)

### 새로 만든 것

1. **`NotificationWidget.tsx`**: `WidgetCard` 패턴(`UpcomingWidget.tsx` 참고)을 따름. props `notifications`, `onSelect`, `onMarkAllRead`. 최근 6개만 노출, 헤더 벨 드롭다운과 동일한 제목·본문·상대시간·안읽음 점 렌더링(`relativeLabel` 헬퍼를 이 파일 전용으로 복제 — `HeaderMenus.tsx`의 것과 동일 로직이지만 export되어 있지 않아 재사용 불가).
2. **`dashboard-widgets.ts`에 등록**: `DASHBOARD_WIDGETS`에 `{ id: 'notifications', title: '알림', description: '...' }` 추가, `DELETABLE_DASHBOARD_WIDGET_IDS`에도 추가(기본 숨김, 사용자가 켜야 보임 — 기존 `upcoming`/`mix`/`subscriptions`/`payment-instruments`와 동일 관례).
3. **`Dashboard.tsx`에 렌더링 연결**: `widgetContent` 맵에 `notifications: <NotificationWidget notifications={notifications} onSelect={...} onMarkAllRead={...} />` 추가. `onSelect`/`onMarkAllRead`는 헤더 벨에 넘기는 것과 동일한 `handleSelectNotification`/`handleMarkAllNotificationsRead`를 그대로 재사용.
4. `DashboardWidgetManager.tsx`의 위젯 켜기/끄기 UI는 `DASHBOARD_WIDGETS`/`DELETABLE_DASHBOARD_WIDGET_IDS` 배열을 그대로 순회하므로, 새 위젯을 위한 별도 코드 변경이 필요 없었다.

## 검증

### 1) 빌드/타입 체크

```
cd web && npm run build
```

`tsc --noEmit` + `vite build` 모두 오류 없이 통과. (기존과 동일하게 청크 크기 경고만 표시 — 이번 변경과 무관, 이전부터 있던 경고.)

### 2) 계획서 "검증" 섹션 시나리오 코드 재점검 (정적 트레이스, 별도 서브에이전트로 교차 검증)

**Part A**

| # | 시나리오 | 결과 |
|---|---|---|
| 1 | 캡션 없이 동명 구독 영수증 첨부 → `receiptNameOverlap` 계산·필드 세팅이 앱 b7ae208과 동일 | PASS |
| 2 | "변경" 버튼(후보 1개) → `handleSelectCandidate` 로컬 분기 → `updateSubscription` | PASS |
| 3 | "별도로 추가" → 로컬로 `extract` 세팅, `send('별도 구독')` 생략, `ChatInlineCard`로 전환 | PASS |
| 4 | "등록" → `handleRegister`가 `duplicateAccountIssue` 사전 검사로 `awaitingAccount` 세팅 | PASS |
| 5 | 계정 답장(예: 이메일) → 병합 후 재검사·`createSubscription`·`registered` 전환 | PASS |
| 6 | "없어"/"몰라" 답장 → 재요청, 등록 안 됨 | PASS |
| 7 | "취소" 답장 → `awaitingAccount` 해제, 카드는 남음 | PASS |
| 8 | 형제 구독이 쓰는 계정으로 답장 → "taken" 문구, 재답장 대기 | PASS |
| 9 | "그대로 두기" → 카드 닫힘, 미등록 | PASS |
| 10 | 동명 2개 이상 → 후보 카드 여러 개, `fromReceiptImage`일 때만 "삭제" 버튼 숨김(텍스트 경로는 그대로 유지) | PASS |
| 11 | 완전히 새 서비스 영수증 → `receiptNameOverlap` false, 평소처럼 등록 확인 카드(회귀 없음) | PASS |
| 12 | `awaitingAccount`/열린 영수증이 없을 때 텍스트는 평소처럼 `assistant-turn`으로 라우팅 | PASS |
| 13 | 영수증 한 장씩 제약 — 열린 카드 있을 때 새 이미지 차단, "취소" 답장으로 닫고 재전송 허용 | PASS |

**Part B**

| # | 시나리오 | 결과 |
|---|---|---|
| 14 | 위젯 켜기/끄기·순서 변경이 기존 위젯과 동일하게 동작(`DELETABLE_DASHBOARD_WIDGET_IDS` 기반 자동 반영) | PASS |
| 15 | 위젯에서 알림 클릭 → 벨 드롭다운과 동일한 `handleSelectNotification` 호출 | PASS |
| 16 | 위젯 "모두 읽음" → 벨 드롭다운과 동일한 `handleMarkAllNotificationsRead` 호출 | PASS |

발견된 버그 없음.

### 3) 수동 확인 (미실시)

계획서의 "앱과 동일한 시나리오를 웹 UI로 수동 확인" 항목은 브라우저 실행이 필요해 이번 작업에서는 진행하지 않았다. 위 표는 코드를 정적으로 추적한 결과이며, 실제 브라우저 확인은 별도로 필요하다.

## 배포

- 서버 변경 없음 — Part A는 이미 배포된 `claude-proxy`/`assistant-turn`을 그대로 호출, Part B는 순수 프론트엔드.
- 계획서는 완료 후 `cd web && npm run build && npx wrangler deploy`를 명시하고 있으나, 이번 작업 범위에서는 배포를 실행하지 않았다(사용자 확인 후 별도 진행 필요).
