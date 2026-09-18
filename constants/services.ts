import type { ImageSourcePropType } from 'react-native';

import type { SystemCategoryKey } from '@/types/category';

export type PresetService = {
  id: string;
  name: string;
  shortName: string;
  /** 시스템 카테고리 키. 선택 시 유저의 해당 카테고리 row id로 매핑된다 */
  category: SystemCategoryKey;
  icon: ImageSourcePropType;
  /** ChatGPT 수정: 투명 여백이 큰 브랜드 로고의 프레임 대비 표시 비율. */
  iconScale?: number;
  /** 브랜드가 요구하는 경우에만 테마별 로고 플레이트를 재정의한다. */
  iconBackgroundLight?: string;
  iconBackgroundDark?: string;
};

export const PRESET_SERVICES: PresetService[] = [
  {
    id: 'netflix',
    name: '넷플릭스',
    shortName: '넷플릭스',
    category: 'entertainment',
    icon: require('../assets/images/services/icon_netflix.png'),
  },
  {
    id: 'youtube-premium',
    name: '유튜브',
    shortName: '유튜브',
    category: 'entertainment',
    icon: require('../assets/images/services/logo_youtube.png'),
  },
  {
    id: 'tving',
    name: '티빙',
    shortName: '티빙',
    category: 'entertainment',
    icon: require('../assets/images/services/icon_tving.png'),
  },
  {
    id: 'disney-plus',
    name: '디즈니+',
    shortName: '디즈니+',
    category: 'entertainment',
    icon: require('../assets/images/services/icon_disney.png'),
    iconScale: 0.92,
  },
  {
    id: 'wavve',
    name: '웨이브',
    shortName: '웨이브',
    category: 'entertainment',
    icon: require('../assets/images/services/icon_wavve.png'),
  },
  {
    id: 'watcha',
    name: '왓챠',
    shortName: '왓챠',
    category: 'entertainment',
    icon: require('../assets/images/services/icon_watcha.png'),
  },
  {
    id: 'apple-tv',
    name: '애플 TV',
    shortName: '애플 TV',
    category: 'entertainment',
    icon: require('../assets/images/services/icon_apple_tv_dark.png'),
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    shortName: 'ChatGPT',
    category: 'work',
    icon: require('../assets/images/services/icon_chatgpt.png'),
  },
  {
    id: 'google-ai',
    name: 'Google AI',
    shortName: 'Google AI',
    category: 'work',
    icon: require('../assets/images/services/logo_googleai.png'),
  },
  {
    id: 'claude',
    name: 'Claude',
    shortName: 'Claude',
    category: 'work',
    icon: require('../assets/images/services/icon_claude.png'),
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    shortName: 'Perplexity',
    category: 'work',
    icon: require('../assets/images/services/icon_perplexity.png'),
  },
  {
    id: 'icloud',
    name: 'iCloud',
    shortName: 'iCloud',
    category: 'cloud',
    icon: require('../assets/images/services/icon_apple_one.png'),
  },
  {
    id: 'microsoft-365',
    name: 'MS 365',
    shortName: 'MS 365',
    category: 'cloud',
    icon: require('../assets/images/services/icon_office365.png'),
  },
  {
    id: 'kakao-emoticon',
    name: '카카오',
    shortName: '카카오',
    category: 'etc',
    icon: require('../assets/images/services/logo_kakaoemoticon.png'),
  },
  {
    id: 'naver-plus',
    name: '네이버+',
    shortName: '네이버+',
    category: 'etc',
    icon: require('../assets/images/services/icon_naver.png'),
  },
  {
    id: 'coupang',
    name: '쿠팡',
    shortName: '쿠팡',
    category: 'etc',
    icon: require('../assets/images/services/icon_coupang.png'),
  },
  {
    id: 'toss-prime',
    name: '토스',
    shortName: '토스',
    category: 'etc',
    icon: require('../assets/images/services/icon_toss_prime.png'),
  },
];

const PRESET_BY_ID = new Map(PRESET_SERVICES.map((service) => [service.id, service]));

export function getPresetService(presetId: string | null | undefined): PresetService | undefined {
  if (!presetId) return undefined;
  return PRESET_BY_ID.get(presetId);
}

/** Claude가 뽑은 서비스명을 프리셋에 붙인다. 완전 일치 우선, 그다음 포함. */
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
    const names = [service.name, service.shortName].map((value) =>
      value.toLowerCase().replace(/\s+/g, '')
    );
    return names.some((value) => value.length >= 2 && (needle.includes(value) || value.includes(needle)));
  });
}
