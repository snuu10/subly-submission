import type { SystemCategoryKey } from '@/types/category';

/**
 * 시스템 카테고리 라벨·색상의 원본은 DB(system_category_seed)다. 여기 있는 값은
 * 시딩 전 화면이나 프리셋 매핑 라벨에 쓰는 폴백이므로 마이그레이션과 동일하게 유지한다.
 */
export const SYSTEM_CATEGORY_LABELS: Record<SystemCategoryKey, string> = {
  entertainment: 'OTT',
  music: '음악',
  work: '업무',
  health: '건강',
  education: '교육',
  cloud: '클라우드',
  etc: '기타',
};

/** 커스텀 카테고리 색상 자동 배정용. 추가 순서대로 순환한다. */
export const CATEGORY_PALETTE = [
  '#4F46E5',
  '#DB2777',
  '#0D9488',
  '#EA580C',
  '#7C3AED',
  '#0284C7',
  '#65A30D',
  '#BE123C',
] as const;

export function nextCategoryColor(existingCustomCount: number): string {
  return CATEGORY_PALETTE[existingCustomCount % CATEGORY_PALETTE.length];
}
