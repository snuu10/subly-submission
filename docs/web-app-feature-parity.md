# 앱 · 웹 기능 차이 정리

갱신: 2026-09-15

앱(Expo/React Native, `app/`)과 웹(`web/src/`)의 기능 차이를 한눈에 보기 위한 문서. 어느 한쪽에 기능이 추가·제거되면 이 표도 함께 갱신한다.

## 기능 비교

| 기능 | 앱 | 웹 | 비고 |
|---|---|---|---|
| 구독 등록/수정/삭제/일시정지·재개 | ✅ | ✅ | 동일 |
| 영수증 사진 첨부 → AI 자동 등록 | ✅ (`app/receipt/*`, `app/chat.tsx`) | ✅ | 이번 세션에 웹 `AssistantPanel.tsx`에 이식 완료(전용 `app/receipt/*` 3단계 플로우는 앱에만 있고, 웹은 채팅 내 첨부만 지원) |
| AI 비서 채팅(등록·수정·삭제·해지 안내·이용확인·정리추천·중복계정 처리) | ✅ (`app/chat.tsx`) | ✅ (`AssistantPanel.tsx`) | 카드 구성(CancelGuideCard/ChatActionCard/ChatInlineCard/CleanupRecommendCard/LifecycleConfirmCard/UsageCheckinCard) 동일하게 존재 |
| 구독 목록 검색 | ✅ (`app/(tabs)/subscriptions.tsx`) | ✅ (`SubscriptionListWidget.tsx`, 이번 세션 추가) | 웹은 최근에야 추가됨. 앱은 이미 있었음 |
| 알림 — 헤더 벨/목록 | — | ✅ (`HeaderMenus.tsx`) | 앱은 벨 드롭다운 대신 `app/notifications.tsx` 전용 화면 |
| 알림 — 전용 화면/탭 | ✅ (`app/notifications.tsx`) | 헤더 드롭다운으로 대체 | UI 형태만 다름, 기능은 동등 |
| 알림 — 대시보드 위젯 노출 | — | ✅ (`NotificationWidget.tsx`, 이번 세션 추가) | 앱은 대시보드 자체가 없어 해당 없음 |
| 푸시 알림(결제 예정 등) | ✅ (`expo-notifications`, `app/_layout.tsx`) | — | 브라우저 푸시 미구현. 모바일 전용 기능 |
| 알림 수신 설정(세부 항목, 매너모드) | ✅ (`app/notification-settings.tsx`) | ❌ | 웹 `AccountSettingsWidget.tsx`(설정 화면)에 비밀번호 변경은 있으나 알림 세부 수신·매너모드 설정 UI는 없음 — 앱 전용 |
| 대시보드 위젯 자유 배치(표시/숨김/순서) | — | ✅ (`lib/dashboard-widgets.ts` + `DashboardWidgetManager`) | 앱은 `home.tsx`가 고정 레이아웃, 커스터마이즈 불가 |
| 결제수단(은행/카드) 관리 | ✅ (`app/payment-methods.tsx`) | ✅ (`PaymentInstrumentListWidget`/`PaymentMethodsWidget`, `PaymentInstrumentModal`) | 동일 |
| 카테고리 관리(순서·이름·숨김) | ✅ (`app/categories.tsx`) | ✅ (`CategoryOrderWidget`, `CategoryWidget`) | 동일 |
| 해지 안내(Cancel-guide) | ✅ (채팅 내 카드) | ✅ (채팅 내 카드) | 동일 |
| 로그인 | ✅ (`app/(onboarding)/index.tsx`) | ✅ (`Login.tsx`) | 동일 |
| 회원가입 | ✅ (`app/(onboarding)/index.tsx`) | ✅ (`Login.tsx` 내 통합) | 동일 |
| 카카오 로그인 | ✅ | ✅ (`Login.tsx`) | 동일 |
| 아이디/비밀번호 찾기 | ✅ | ✅ (`Login.tsx`) | 동일 |
| 비밀번호 변경 | ✅ (`app/change-password.tsx`) | ✅ (`AccountSettingsWidget.tsx`, 설정 화면 내) | 동일 |
| 사용 기록(usage history) | ✅ (`app/usage-history.tsx`) | ✅ (`UsageHistoryWidget`) | 동일 |
| 결제 현황(월별 결제 브리핑) | ✅ (`app/(tabs)/stats.tsx`) | ✅ (`PaymentStatusWidget`) | 동일 |
| 앱 다운로드(APK/IPA 배포) 페이지 | — | ✅ (`Releases.tsx`) | 웹 전용은 당연함(앱이 자기 자신을 배포할 필요 없음) |

## 구조적 차이(참고)

- 웹은 `Dashboard.tsx` 한 화면 안에서 `DashboardView`(dashboard/paymentStatus/list/upcoming/usageHistory/categories/banks/cards/settings)를 전환하는 SPA 구조, 앱은 Expo Router로 화면이 파일 단위로 분리되어 있음. 화면 수가 다른 건 대부분 이 구조 차이 때문이며 기능 누락이 아니다.
- `docs/rules/product.md`에 "안드로이드 출시 우선, 이후 크로스플랫폼"이 명시돼 있어, 푸시 알림처럼 모바일 전용 OS 기능이 앱에만 있는 것은 의도된 차이다.

## 확인 필요

- 영수증 첨부 세부 플로우(계정 충돌 처리, 한 장 제한 등)는 이번 세션에 앱→웹으로 포팅되어 기능적으로 동등함을 이미 별도 검증(포크 감사)까지 마쳤음 — 이 표에서는 존재 여부만 재확인.
