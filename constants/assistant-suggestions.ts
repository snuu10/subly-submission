// supabase/functions/assistant-turn/suggestions.ts의 복제본.
// 정본이 바뀌면 여기도 바꾼다. 어긋나면 gemini-intent.test.ts의 드리프트 테스트가 실패한다.

export const STARTER_SUGGESTIONS: string[] = [
  '새 구독 등록할게',
  '이번 달 얼마 나가?',
  '카테고리 현황 보여줘',
  '제일 비싼 구독 3개',
  '다가오는 결제',
];

export const FOLLOW_UP_SUGGESTIONS: Record<string, string[]> = {
  monthly_total: ['카테고리 현황 보여줘', '다음 달 얼마 나가?'],
  category_analysis: ['제일 비싼 구독 3개', '이번 달 얼마 나가?'],
  list_subscriptions: ['카테고리 현황 보여줘', '제일 비싼 구독 3개'],
  upcoming_payments: ['이번 달 얼마 나가?', '정리 추천해줘'],
  expensive_subscriptions: ['정리 추천해줘', '카테고리 현황 보여줘'],
  cleanup_candidates: ['제일 비싼 구독 3개', '이번 달 얼마 나가?'],
};

export function followUpSuggestions(intent: string | null | undefined): string[] {
  if (!intent) return [];
  return FOLLOW_UP_SUGGESTIONS[intent] ?? [];
}
