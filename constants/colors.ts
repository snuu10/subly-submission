import { useColorScheme } from '@/components/useColorScheme';

/** 카테고리가 아직 로드되지 않았거나 매칭에 실패했을 때 쓰는 중립 색. */
export const CATEGORY_FALLBACK_COLOR = '#6B7280';

/**
 * 카테고리 색상은 이제 DB에 문자열로 저장되므로 배경 톤을 미리 매핑해둘 수 없다.
 * 원색에 알파를 붙여 파생시킨다. 6자리 hex가 아니면 그대로 반환한다.
 */
export function categoryBg(color: string | undefined, alpha = '22'): string {
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `${CATEGORY_FALLBACK_COLOR}${alpha}`;
  }
  return `${color}${alpha}`;
}

export const colors = {
  light: {
    background: '#F9FAFB',
    surface: '#FFFFFF',
    text: '#111827',
    muted: '#9CA3AF',
    primary: '#4F46E5',
    primaryText: '#FFFFFF',
    accent: '#EEF2FF',
    border: 'rgba(0,0,0,0.06)',
    chip: '#FFFFFF',
    chipSelected: '#4F46E5',
    chipSelectedText: '#FFFFFF',
    danger: '#E11D48',
    tabBar: 'rgba(255,255,255,0.95)',
    warning: '#D97706',
    warningBg: '#FFFBEB',
    success: '#059669',
    successBg: '#F0FDF4',
    rose: '#FB7185',
    roseBg: '#FFF1F2',
    amber: '#F59E0B',
    amberBg: '#FFFBEB',
  },
  dark: {
    background: '#111827',
    surface: '#1F2937',
    text: '#F9FAFB',
    muted: '#9CA3AF',
    primary: '#6366F1',
    primaryText: '#FFFFFF',
    accent: '#312E81',
    border: 'rgba(255,255,255,0.08)',
    chip: '#374151',
    chipSelected: '#6366F1',
    chipSelectedText: '#FFFFFF',
    danger: '#FB7185',
    tabBar: 'rgba(31,41,55,0.95)',
    warning: '#FBBF24',
    warningBg: '#422006',
    success: '#34D399',
    successBg: '#064E3B',
    rose: '#FB7185',
    roseBg: '#4C0519',
    amber: '#FBBF24',
    amberBg: '#422006',
  },
};

export type ThemeColors = (typeof colors)['light'];

export function useThemeColors(): ThemeColors {
  const scheme = useColorScheme();
  return colors[scheme === 'dark' ? 'dark' : 'light'];
}
