import type { SystemCategoryKey } from '@/types';

export type PresetHint = {
  id: string;
  name: string;
  shortName: string;
  category: SystemCategoryKey;
};

const PRESETS: PresetHint[] = [
  { id: 'netflix', name: '넷플릭스', shortName: '넷플릭스', category: 'entertainment' },
  { id: 'youtube-premium', name: '유튜브', shortName: '유튜브', category: 'entertainment' },
  { id: 'tving', name: '티빙', shortName: '티빙', category: 'entertainment' },
  { id: 'disney-plus', name: '디즈니+', shortName: '디즈니+', category: 'entertainment' },
  { id: 'wavve', name: '웨이브', shortName: '웨이브', category: 'entertainment' },
  { id: 'watcha', name: '왓챠', shortName: '왓챠', category: 'entertainment' },
  { id: 'apple-tv', name: '애플 TV', shortName: '애플 TV', category: 'entertainment' },
  { id: 'chatgpt', name: 'ChatGPT', shortName: 'ChatGPT', category: 'work' },
  { id: 'google-ai', name: 'Google AI', shortName: 'Google AI', category: 'work' },
  { id: 'claude', name: 'Claude', shortName: 'Claude', category: 'work' },
  { id: 'perplexity', name: 'Perplexity', shortName: 'Perplexity', category: 'work' },
  { id: 'icloud', name: 'iCloud', shortName: 'iCloud', category: 'cloud' },
  { id: 'microsoft-365', name: 'MS 365', shortName: 'MS 365', category: 'cloud' },
  { id: 'kakao-emoticon', name: '카카오', shortName: '카카오', category: 'etc' },
  { id: 'naver-plus', name: '네이버+', shortName: '네이버+', category: 'etc' },
  { id: 'coupang', name: '쿠팡', shortName: '쿠팡', category: 'etc' },
  { id: 'toss-prime', name: '토스', shortName: '토스', category: 'etc' },
];

export function matchPresetByName(name: string): PresetHint | undefined {
  const needle = name.trim().toLowerCase().replace(/\s+/g, '');
  if (!needle) return undefined;

  const exact = PRESETS.find((service) => {
    const names = [service.name, service.shortName, service.id].map((value) =>
      value.toLowerCase().replace(/\s+/g, '')
    );
    return names.includes(needle);
  });
  if (exact) return exact;

  return PRESETS.find((service) => {
    const names = [service.name, service.shortName].map((value) =>
      value.toLowerCase().replace(/\s+/g, '')
    );
    return names.some((value) => value.length >= 2 && (needle.includes(value) || value.includes(needle)));
  });
}
