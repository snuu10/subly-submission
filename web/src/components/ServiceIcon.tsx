import {
  BookOpen, Bot, BriefcaseBusiness, CirclePlay, Cloud, Dumbbell, FileText, Film,
  Gamepad2, Globe2, Heart, Music, Package, Palette, Tv, Zap,
} from 'lucide-react';

import { decodeServiceIcon, defaultServiceIcon, type ServiceIconKey } from '@/lib/service-icons';
import { getPresetService, matchPresetByName } from '@/lib/services';
import type { SystemCategoryKey } from '@/types';

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
  'globe-2': Globe2,
  package: Package,
  heart: Heart,
  zap: Zap,
} satisfies Record<ServiceIconKey, typeof Film>;

type ServiceIconProps = {
  presetId?: string | null;
  name: string;
  color?: string | null;
  emoji?: string | null;
  categoryKey?: SystemCategoryKey | null;
  size?: number;
};

export function ServiceIcon({ presetId, name, color, emoji, categoryKey, size = 32 }: ServiceIconProps) {
  const preset = getPresetService(presetId) ?? matchPresetByName(name);
  const encodedIcon = decodeServiceIcon(emoji);
  const iconKey = encodedIcon ?? defaultServiceIcon(categoryKey);
  const Icon = LUCIDE_ICONS[iconKey];
  const foreground = color ?? '#64748B';
  const background = color ? `${color}1A` : '#F1F5F9';

  if (preset) {
    return (
      <span
        role="img"
        aria-label={`${preset.name} 로고`}
        className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-white"
        style={{ width: size, height: size }}
      >
        <img
          src={preset.icon}
          alt=""
          style={{ width: size * (preset.iconScale ?? 0.78), height: size * (preset.iconScale ?? 0.78) }}
          className="object-contain"
        />
      </span>
    );
  }

  if (emoji && !encodedIcon) {
    return (
      <span
        role="img"
        aria-label={`${name || '서비스'} 아이콘`}
        className="inline-flex shrink-0 items-center justify-center rounded-xl"
        style={{ width: size, height: size, backgroundColor: background, fontSize: size * 0.5 }}
      >
        {emoji}
      </span>
    );
  }

  return (
    <span
      aria-label={`${name || '서비스'} 아이콘`}
      className="inline-flex shrink-0 items-center justify-center rounded-xl"
      style={{ width: size, height: size, backgroundColor: background, color: foreground }}
    >
      <Icon aria-hidden="true" size={size * 0.5} strokeWidth={2.2} />
    </span>
  );
}
