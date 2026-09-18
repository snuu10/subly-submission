/** 홈·통계 차트가 공유하는 간격·크기. 막대 fill은 카테고리 DB 색을 그대로 쓴다. */
export const CHART = {
  cardRadius: 16,
  cardPadding: 20,
  cardGap: 14,
  barHeight: 10,
  barRadius: 999,
  barFillOpacity: 0.82,
  barFillEmphasis: 1,
  donutSize: 148,
  donutStroke: 20,
  donutGap: 3,
  insightRadius: 999,
  insightPadX: 10,
  insightPadY: 6,
} as const;

export function sharePercent(amount: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((amount / total) * 100);
}
