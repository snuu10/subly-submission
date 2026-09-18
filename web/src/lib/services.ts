import type { SystemCategoryKey } from '@/types';

export type PresetService = {
  id: string;
  name: string;
  shortName: string;
  category: SystemCategoryKey;
  icon: string;
  iconScale?: number;
};

const serviceIcons = import.meta.glob('../../../assets/images/services/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

function iconFor(fileName: string): string {
  const hit = Object.entries(serviceIcons).find(([path]) => path.endsWith(`/${fileName}`));
  return hit?.[1] ?? '';
}

export const PRESET_SERVICES: PresetService[] = [
  { id: 'netflix', name: '넷플릭스', shortName: '넷플릭스', category: 'entertainment', icon: iconFor('icon_netflix.png') },
  { id: 'youtube-premium', name: '유튜브', shortName: '유튜브', category: 'entertainment', icon: iconFor('logo_youtube.png') },
  { id: 'tving', name: '티빙', shortName: '티빙', category: 'entertainment', icon: iconFor('icon_tving.png') },
  { id: 'disney-plus', name: '디즈니+', shortName: '디즈니+', category: 'entertainment', icon: iconFor('icon_disney.png'), iconScale: 0.92 },
  { id: 'wavve', name: '웨이브', shortName: '웨이브', category: 'entertainment', icon: iconFor('icon_wavve.png') },
  { id: 'watcha', name: '왓챠', shortName: '왓챠', category: 'entertainment', icon: iconFor('icon_watcha.png') },
  { id: 'apple-tv', name: '애플 TV', shortName: '애플 TV', category: 'entertainment', icon: iconFor('icon_apple_tv_dark.png') },
  { id: 'chatgpt', name: 'ChatGPT', shortName: 'ChatGPT', category: 'work', icon: iconFor('icon_chatgpt.png') },
  { id: 'google-ai', name: 'Google AI', shortName: 'Google AI', category: 'work', icon: iconFor('logo_googleai.png') },
  { id: 'claude', name: 'Claude', shortName: 'Claude', category: 'work', icon: iconFor('icon_claude.png') },
  { id: 'perplexity', name: 'Perplexity', shortName: 'Perplexity', category: 'work', icon: iconFor('icon_perplexity.png') },
  { id: 'icloud', name: 'iCloud', shortName: 'iCloud', category: 'cloud', icon: iconFor('icon_apple_one.png') },
  { id: 'microsoft-365', name: 'MS 365', shortName: 'MS 365', category: 'cloud', icon: iconFor('icon_office365.png') },
  { id: 'kakao-emoticon', name: '카카오', shortName: '카카오', category: 'etc', icon: iconFor('logo_kakaoemoticon.png') },
  { id: 'naver-plus', name: '네이버+', shortName: '네이버+', category: 'etc', icon: iconFor('icon_naver.png') },
  { id: 'coupang', name: '쿠팡', shortName: '쿠팡', category: 'etc', icon: iconFor('icon_coupang.png') },
  { id: 'toss-prime', name: '토스', shortName: '토스', category: 'etc', icon: iconFor('icon_toss_prime.png') },
];

const PRESET_BY_ID = new Map(PRESET_SERVICES.map((service) => [service.id, service]));

export function getPresetService(presetId: string | null | undefined): PresetService | undefined {
  if (!presetId) return undefined;
  return PRESET_BY_ID.get(presetId);
}

/** 앱(`constants/services.ts`)의 matchPresetByName과 동일한 규칙: 완전 일치 우선, 그다음 포함. */
export function matchPresetByName(name: string): PresetService | undefined {
  const needle = name.trim().toLowerCase().replace(/\s+/g, '');
  if (!needle) return undefined;

  const exact = PRESET_SERVICES.find((service) => {
    const names = [service.name, service.shortName, service.id].map((value) =>
      value.toLowerCase().replace(/\s+/g, '')
    );
    return names.includes(needle);
  });
  if (exact) return exact;

  return PRESET_SERVICES.find((service) => {
    const names = [service.name, service.shortName].map((value) => value.toLowerCase().replace(/\s+/g, ''));
    return names.some((value) => value.length >= 2 && (needle.includes(value) || value.includes(needle)));
  });
}
