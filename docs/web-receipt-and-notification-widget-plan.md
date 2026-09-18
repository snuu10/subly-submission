# 웹: 영수증 사진 첨부 기능 + 알림 위젯

갱신: 2026-09-15

앱(`app/chat.tsx`)에는 이미 있는 영수증 사진 등록 흐름을 웹(`web/src/components/AssistantPanel.tsx`)에도 새로 만들고,
헤더 벨 아이콘([HeaderMenus.tsx](../web/src/components/HeaderMenus.tsx))에 숨어 있는 알림을 대시보드 위젯으로도 보이게 한다.
관련 배경: [docs/receipt-duplicate-registration-plan.md](./receipt-duplicate-registration-plan.md),
[docs/receipt-duplicate-registration-report.md](./receipt-duplicate-registration-report.md) — 이번 작업은 그 두 문서에서
앱에 이미 구현·검증된 로직을 웹으로 이식하는 것이다.

## Part A. 웹 영수증 사진 첨부

### 이미 있는 것 (재사용)

- `web/src/lib/claude.ts` — `lib/claude.ts`(앱)의 웹판. `invokeClaude` 존재 여부와 시그니처를 먼저 확인하고 앱과 동일하게 맞춘다.
- `AssistantPanel.tsx`의 `ChatItem`에 이미 `pendingAction`/`pendingExtract`/`duplicateCreate`/`candidates` 필드가 있고,
  [AssistantPanel.tsx:1179](../web/src/components/AssistantPanel.tsx#L1179) 부근에 텍스트 경로의 3버튼(`duplicateCreate`) 카드도 이미 렌더링된다.
- `lib/duplicate-account.ts`의 `duplicateAccountIssue`/`duplicateAccountMessage` — 웹도 `web/src/lib/data.ts`의
  `createSubscription`이 이미 내부에서 쓰고 있다(구독 이름 정본은 `lib/duplicate-account.ts` 한 곳, 웹은 같은 파일을 import해서 씀 —
  중복 안 만들고 그대로 import해서 쓸 것. `web/src/lib/duplicate-account.ts`가 따로 있으면 그쪽을 대신 확인).

### 새로 만들 것

1. **사진 첨부 UI**: `<input type="file" accept="image/*">` + 미리보기. `FileReader.readAsDataURL`로 base64 인코딩(앱의
   `pickReceiptImage`가 하는 일의 웹 버전). 첨부 상태를 `pendingImage` 같은 로컬 state로 관리(앱과 동일한 이름 권장).
2. **전송 분기**: `send()` 함수에서 이미지가 있으면 `invokeClaude`(claude-proxy), 없으면 기존 `invokeAssistantTurn` 호출.
3. **`ChatItem`에 필드 추가**: `fromReceiptImage?: boolean`, `awaitingAccount?: boolean` (앱과 동일한 이름).
4. **`receiptNameOverlap` 판정 + 3버튼 카드 전환**: 앱 `chat.tsx`의 다음 블록을 그대로 이식 —
   - `receiptNameOverlap` 계산(이미지 턴 + 이름 매치 시 항상 선택 카드, 캡션 키워드로 추측 안 함)
   - `candidatesFromIds` 공용 추출
   - `receiptNameOverlap`이면 `duplicateCreate`/`candidates`/`pendingAction`/`pendingExtract`/`fromReceiptImage` 채우기
   - 구체적 코드는 [docs/receipt-duplicate-registration-report.md](./receipt-duplicate-registration-report.md)의
     "변경 요약" 1번, 그리고 실제 diff는 `git show b7ae208 -- app/chat.tsx`로 확인.
5. **"별도로 추가" 버튼 로컬 처리**: 웹의 `duplicateCreate` 렌더링 블록에서 "별도로 추가"에 해당하는 버튼을 찾아,
   `item.fromReceiptImage`일 때 `handleSend('별도 구독')`(서버 텍스트 왕복) 대신 로컬로 `item.extract`를 채워 등록 확인 카드로
   전환한다. 앱 쪽 최종 코드: `git show b7ae208 -- app/chat.tsx`에서 `onPress={() => {` 블록.
6. **"계정 필요" → 채팅 답장으로 자동 등록**: 앱의 `handleRegister` 사전 검사(`duplicateAccountIssue`) +
   `handleSend` 맨 앞 가로채기(`pendingAccountItem` 처리, `looksLikeAccountDodge`/`looksLikeAccountCancel` 헬퍼 포함)를
   웹의 `handleRegister`/`send` 함수에 동일하게 이식. 웹의 등록 직접 저장 경로는 `createSubscription`(`web/src/lib/data.ts`)을
   쓴다 — 앱의 `addSubscription`과 시그니처가 다르니(두 번째 인자로 `existing` 배열을 받음) 그에 맞게 호출부를 조정할 것.
7. **영수증 한 장씩 제약 + 채팅으로 취소**: 앱의 최종 가드(커밋 `b7ae208` 이후 마지막 수정, 이 세션에서 추가)를 그대로 이식 —
   `openReceiptItem`이 있을 때 "취소" 답장이면 그 카드를 `dismissed`로 닫고, 아니면(그리고 새 이미지를 보내려 하면) 차단하고
   안내. `git log -p --all -- app/chat.tsx`에서 "영수증은 한 장씩" 커밋 참고.

### 검증

- `cd web && npm run build` (타입 체크 + 빌드)
- 앱과 동일한 시나리오를 웹 UI로 수동 확인(계획 원본 문서의 "수동 확인" 섹션과 동일한 목록).

## Part B. 알림 위젯 (대시보드)

### 배경

헤더 벨 아이콘([HeaderMenus.tsx](../web/src/components/HeaderMenus.tsx))을 눌러야만 보이는 `AppNotification[]` 목록
(`web/src/lib/notifications.ts`, `Dashboard.tsx`가 이미 `notifications`/`unreadNotificationCount` state로 들고 있음,
[Dashboard.tsx:101](../web/src/pages/Dashboard.tsx#L101))을, 드롭다운을 열지 않아도 보이도록 **대시보드 위젯으로도** 노출한다.
드롭다운은 그대로 두고(제거하지 않음) 위젯을 **추가**하는 것.

### 새로 만들 것

1. **`web/src/components/widgets/NotificationWidget.tsx`** — 기존 위젯 패턴을 따른다(예: `UpcomingWidget.tsx` 구조 참고).
   props로 `notifications: AppNotification[]`, `onSelect: (item: AppNotification) => void`,
   `onMarkAllRead: () => void`를 받아 [HeaderMenus.tsx:137-165](../web/src/components/HeaderMenus.tsx#L137-L165)와
   동일한 목록 렌더링(제목·본문·상대시간·안읽음 표시)을 위젯 카드 형태로 보여준다. 목록이 길면 최근 N개만 보여주고
   "모두 보기"는 필요 없음(벨 드롭다운이 이미 전체 목록 역할).
2. **`web/src/lib/dashboard-widgets.ts`에 위젯 등록**: `DASHBOARD_WIDGETS` 배열에 `{ id: 'notifications', title: '알림',
   description: '...' }` 추가. `DELETABLE_DASHBOARD_WIDGET_IDS`(기본은 숨김, 사용자가 켜야 보이는 쪽)에 넣을지
   `DEFAULT_DASHBOARD_WIDGET_IDS`(기본 노출)에 넣을지는 다른 신규 위젯 관례를 따라 `DELETABLE_DASHBOARD_WIDGET_IDS`
   권장(기존 `upcoming`/`mix`/`subscriptions`/`payment-instruments`와 동일하게).
3. **`Dashboard.tsx`에 렌더링 연결**: 다른 위젯들처럼(예: [Dashboard.tsx:501](../web/src/pages/Dashboard.tsx#L501)
   `mix: <MixWidget ... />` 패턴) `notifications: <NotificationWidget notifications={notifications}
   onSelect={handleSelectNotification} onMarkAllRead={...} />`를 위젯 맵에 추가. `handleSelectNotification`은
   이미 존재([Dashboard.tsx:426](../web/src/pages/Dashboard.tsx#L426)) — 그대로 재사용.
   "모두 읽음" 핸들러는 `HeaderMenus`에 넘기는 `onMarkAllRead`와 같은 함수를 그대로 재사용.

### 검증

- `cd web && npm run build`
- 대시보드에서 위젯 켜기/끄기·순서 변경이 기존 위젯과 동일하게 동작하는지.
- 위젯에서 알림 클릭 시 벨 드롭다운에서 클릭했을 때와 동일하게 동작하는지(같은 `onSelectNotification` 재사용이므로 회귀 없어야 정상).

## 배포

- 서버 변경 없음(Part A는 이미 배포된 `claude-proxy`/`assistant-turn`을 그대로 호출, Part B는 순수 프론트엔드).
- 완료 후 `cd web && npm run build && npx wrangler deploy`.
