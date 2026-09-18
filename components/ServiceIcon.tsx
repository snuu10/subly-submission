import { Image, StyleSheet, Text, View } from 'react-native';
// 배럴(`lucide-react-native`)에서 import하면 아이콘 1600여 개가 전부 번들에 포함돼
// Hermes 바이트코드 번들이 손상되고 앱이 빈 화면으로 크래시한다. 실제 쓰는 16개만
// 개별 경로로 import해서 이 문제를 피한다.
import BookOpen from 'lucide-react-native/icons/book-open';
import Bot from 'lucide-react-native/icons/bot';
import BriefcaseBusiness from 'lucide-react-native/icons/briefcase-business';
import CirclePlay from 'lucide-react-native/icons/circle-play';
import Cloud from 'lucide-react-native/icons/cloud';
import Dumbbell from 'lucide-react-native/icons/dumbbell';
import FileText from 'lucide-react-native/icons/file-text';
import Film from 'lucide-react-native/icons/film';
import Gamepad2 from 'lucide-react-native/icons/gamepad-2';
import Globe from 'lucide-react-native/icons/globe';
import Heart from 'lucide-react-native/icons/heart';
import Music from 'lucide-react-native/icons/music';
import Package from 'lucide-react-native/icons/package';
import Palette from 'lucide-react-native/icons/palette';
import Tv from 'lucide-react-native/icons/tv';
import Zap from 'lucide-react-native/icons/zap';

import { useColorScheme } from '@/components/useColorScheme';
import { CATEGORY_FALLBACK_COLOR, categoryBg } from '@/constants/colors';
import { getPresetService, matchPresetByName } from '@/constants/services';
import { decodeServiceIcon, defaultServiceIcon, type ServiceIconKey } from '@/constants/service-icons';
import type { SystemCategoryKey } from '@/types/category';

const LUCIDE_ICONS = {
  film: Film,
  music: Music,
  play: CirclePlay,
  cloud: Cloud,
  palette: Palette,
  'file-text': FileText,
  bot: Bot,
  tv: Tv,
  dumbbell: Dumbbell,
  'book-open': BookOpen,
  'gamepad-2': Gamepad2,
  'briefcase-business': BriefcaseBusiness,
  'globe-2': Globe,
  package: Package,
  heart: Heart,
  zap: Zap,
} satisfies Record<ServiceIconKey, typeof Film>;

function relativeLuminance(hex: string): number | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function highContrastForeground(background: string): string {
  const luminance = relativeLuminance(background);
  if (luminance === null) return '#FFFFFF';

  const whiteContrast = 1.05 / (luminance + 0.05);
  const darkLuminance = relativeLuminance('#111827') ?? 0;
  const darkContrast = (luminance + 0.05) / (darkLuminance + 0.05);
  return whiteContrast >= darkContrast ? '#FFFFFF' : '#111827';
}

type ServiceIconProps = {
  presetId: string | null;
  name: string;
  /** 카테고리 색상. 미지정이면 중립 색으로 떨어진다 */
  color?: string;
  emoji?: string;
  categoryKey?: SystemCategoryKey | null;
  size?: number;
};

export function ServiceIcon({ presetId, name, color, emoji, categoryKey, size = 32 }: ServiceIconProps) {
  const colorScheme = useColorScheme();
  const preset = getPresetService(presetId) ?? matchPresetByName(name);
  const radius = Math.round(size * 0.28);
  const backgroundColor = categoryBg(color);

  if (preset) {
    // ChatGPT 수정: 어두운 브랜드 자산은 다크모드에서 밝은 로고 플레이트로 분리한다.
    const dark = colorScheme === 'dark';
    const logoBackground = dark
      ? preset.iconBackgroundDark ?? '#F8FAFC'
      : preset.iconBackgroundLight ?? backgroundColor;
    const logoBorder = dark ? '#E5E7EB' : categoryBg(color, '33');
    const iconSize = size * (preset.iconScale ?? 0.78);
    return (
      <View
        accessibilityLabel={`${preset.name} 로고`}
        style={[
          styles.frame,
          {
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor: logoBackground,
            borderColor: logoBorder,
            borderWidth: 1,
          },
        ]}>
        <Image
          source={preset.icon}
          style={[styles.image, { width: iconSize, height: iconSize }]}
          resizeMode="contain"
        />
      </View>
    );
  }

  const lucideKey = decodeServiceIcon(emoji) ?? (!emoji && categoryKey ? defaultServiceIcon(categoryKey) : null);
  if (lucideKey) {
    const LucideIcon = LUCIDE_ICONS[lucideKey];
    const dark = colorScheme === 'dark';
    const iconBackground = dark ? color ?? CATEGORY_FALLBACK_COLOR : backgroundColor;
    const iconForeground = dark
      ? highContrastForeground(iconBackground)
      : color ?? CATEGORY_FALLBACK_COLOR;
    return (
      <View
        accessibilityLabel={`${name || '서비스'} 아이콘`}
        style={[
          styles.frame,
          {
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor: iconBackground,
          },
        ]}>
        <LucideIcon
          color={iconForeground}
          size={size * (dark ? 0.56 : 0.5)}
          strokeWidth={dark ? 2.5 : 2.2}
        />
      </View>
    );
  }

  if (emoji) {
    return (
      <View
        style={[
          styles.frame,
          {
            width: size,
            height: size,
            borderRadius: radius,
            backgroundColor,
          },
        ]}>
        <Text style={{ fontSize: size * 0.5 }}>{emoji}</Text>
      </View>
    );
  }

  const initial = name.trim().charAt(0) || '?';

  return (
    <View
      style={[
        styles.frame,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: color ?? CATEGORY_FALLBACK_COLOR,
        },
      ]}>
      <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    flexShrink: 0,
  },
  initial: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
});
