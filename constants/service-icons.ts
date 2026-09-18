import type { SystemCategoryKey } from '@/types/category';

export const SERVICE_ICON_KEYS = [
  'film',
  'music',
  'play',
  'cloud',
  'palette',
  'file-text',
  'bot',
  'tv',
  'dumbbell',
  'book-open',
  'gamepad-2',
  'briefcase-business',
  'globe-2',
  'package',
  'heart',
  'zap',
] as const;

export type ServiceIconKey = (typeof SERVICE_ICON_KEYS)[number];

export const SERVICE_ICON_OPTIONS: { key: ServiceIconKey; label: string }[] = [
  { key: 'film', label: '영화' },
  { key: 'music', label: '음악' },
  { key: 'play', label: '영상' },
  { key: 'cloud', label: '클라우드' },
  { key: 'palette', label: '디자인' },
  { key: 'file-text', label: '문서' },
  { key: 'bot', label: 'AI' },
  { key: 'tv', label: 'TV' },
  { key: 'dumbbell', label: '운동' },
  { key: 'book-open', label: '교육' },
  { key: 'gamepad-2', label: '게임' },
  { key: 'briefcase-business', label: '업무' },
  { key: 'globe-2', label: '인터넷' },
  { key: 'package', label: '기타' },
  { key: 'heart', label: '생활' },
  { key: 'zap', label: '유틸리티' },
];

const CATEGORY_DEFAULT_ICON: Record<SystemCategoryKey, ServiceIconKey> = {
  entertainment: 'film',
  music: 'music',
  work: 'briefcase-business',
  health: 'dumbbell',
  education: 'book-open',
  cloud: 'cloud',
  etc: 'package',
};

export function isServiceIconKey(value: unknown): value is ServiceIconKey {
  return typeof value === 'string' && (SERVICE_ICON_KEYS as readonly string[]).includes(value);
}

export function encodeServiceIcon(key: ServiceIconKey): string {
  return `lucide:${key}`;
}

export function decodeServiceIcon(value?: string | null): ServiceIconKey | null {
  if (!value?.startsWith('lucide:')) return null;
  const key = value.slice('lucide:'.length);
  return isServiceIconKey(key) ? key : null;
}

export function defaultServiceIcon(categoryKey?: SystemCategoryKey | null): ServiceIconKey {
  return categoryKey ? CATEGORY_DEFAULT_ICON[categoryKey] : 'package';
}
