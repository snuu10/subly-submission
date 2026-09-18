// 비서 추천 명령어의 정본. 여기 있는 문구만 앱·웹 칩으로 노출한다.
// 모든 문구는 gemini-intent.test.ts에서 refineIntent로 의도가 검증된다.
// 문구가 기대 의도로 분류되지 않으면 분류기가 아니라 문구를 바꾼다.

export type StarterSuggestion = {
  label: string;
  intent: string;
  // 등록 문구는 이름이 비어 있어야 비서가 무엇을 등록할지 되묻는다.
  expectsNoServiceName?: boolean;
};

export const STARTER_SUGGESTIONS: StarterSuggestion[] = [
  { label: "새 구독 등록할게", intent: "create_subscription", expectsNoServiceName: true },
  { label: "이번 달 얼마 나가?", intent: "monthly_total" },
  { label: "카테고리 현황 보여줘", intent: "category_analysis" },
  { label: "제일 비싼 구독 3개", intent: "expensive_subscriptions" },
  { label: "다가오는 결제", intent: "upcoming_payments" },
];

// 직전 답변의 intent별 후속 추천. 확인 흐름(생성·수정·삭제·해지)은 자체 카드가 있으므로 비워 둔다.
export const FOLLOW_UP_SUGGESTIONS: Record<string, string[]> = {
  monthly_total: ["카테고리 현황 보여줘", "다음 달 얼마 나가?"],
  category_analysis: ["제일 비싼 구독 3개", "이번 달 얼마 나가?"],
  list_subscriptions: ["카테고리 현황 보여줘", "제일 비싼 구독 3개"],
  upcoming_payments: ["이번 달 얼마 나가?", "정리 추천해줘"],
  expensive_subscriptions: ["정리 추천해줘", "카테고리 현황 보여줘"],
  cleanup_candidates: ["제일 비싼 구독 3개", "이번 달 얼마 나가?"],
};

// 후속 추천 문구의 기대 의도. 테스트가 이 표로 전수 검증한다.
export const FOLLOW_UP_INTENTS: Record<string, string> = {
  "카테고리 현황 보여줘": "category_analysis",
  "다음 달 얼마 나가?": "monthly_total",
  "제일 비싼 구독 3개": "expensive_subscriptions",
  "이번 달 얼마 나가?": "monthly_total",
  "정리 추천해줘": "cleanup_candidates",
};
