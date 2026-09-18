import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { advanceSubscriptionLifecycle, isoDateFromText } from '@/lib/lifecycle';
import { formatShortDate } from '@/stores/subscription-store';
import type { CancelGuideCitation, CancelGuideResponse } from '@/types/cancel-guide';
import type { LifecycleStatus } from '@/types/subscription';

type CancelGuideCardProps = {
  guide: CancelGuideResponse;
  subscriptionId?: string | null;
  lifecycleStatus?: LifecycleStatus | null;
  nextPaymentDate?: string | null;
  onChanged?: () => Promise<void> | void;
  onDeleteFromList?: (subscriptionId: string) => void;
};

function uniqueCitations(guide: CancelGuideResponse): CancelGuideCitation[] {
  const seen = new Set<string>();
  const list: CancelGuideCitation[] = [];
  for (const step of guide.steps) {
    const url = step.citation.url.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    list.push(step.citation);
  }
  return list;
}

function fetchedLabel(iso: string): string {
  try {
    return `정보 기준 ${formatShortDate(iso.slice(0, 10))}`;
  } catch {
    return iso;
  }
}

async function openUrl(url: string) {
  const can = await Linking.canOpenURL(url);
  if (can) await Linking.openURL(url);
}

export function CancelGuideCard({
  guide,
  subscriptionId,
  lifecycleStatus,
  nextPaymentDate,
  onChanged,
  onDeleteFromList,
}: CancelGuideCardProps) {
  const colors = useThemeColors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notFound = guide.status === 'not_found';
  const statusLabel =
    guide.status === 'verified' ? '검수된 안내' : guide.search_failed ? '검색 실패' : '임시 안내';
  const citations = uniqueCitations(guide);
  const status = lifecycleStatus ?? 'active';
  const endDate = isoDateFromText(guide.cancellation_effective_at) ?? nextPaymentDate ?? null;

  async function advance(to: LifecycleStatus) {
    if (!subscriptionId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await advanceSubscriptionLifecycle(
        subscriptionId,
        to,
        to === 'cancel_requested' ? endDate : null,
      );
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '해지 상태를 바꾸지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.head}>
        <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
          {guide.service_name ?? '구독 해지'}
        </Text>
        <View style={[styles.badge, { backgroundColor: colors.accent }]}>
          <Text style={[styles.badgeLabel, { color: colors.primary }]}>{statusLabel}</Text>
        </View>
      </View>
      <Text style={[styles.meta, { color: colors.muted }]}>
        이 안내는 웹 결제 기준이에요. 앱스토어·플레이스토어·통신사로 결제했다면 해당 앱이나
        고객센터에서 확인해 주세요.
      </Text>
      <Text style={[styles.meta, { color: colors.muted }]}>{fetchedLabel(guide.fetched_at)}</Text>

      {guide.steps.map((step) => (
        <View key={step.order} style={styles.step}>
          <Text style={[styles.stepTitle, { color: colors.text }]}>
            {step.order}. {step.description}
          </Text>
        </View>
      ))}

      {guide.cancellation_effective_at ? (
        <Text style={[styles.body, { color: colors.text }]}>
          적용 시점 {guide.cancellation_effective_at}
        </Text>
      ) : null}
      {guide.refund_policy ? (
        <Text style={[styles.body, { color: colors.text }]}>환불 {guide.refund_policy}</Text>
      ) : null}
      {guide.warnings.map((warning) => (
        <Text key={warning} style={[styles.warning, { color: colors.warning }]}>
          {warning}
        </Text>
      ))}
      {guide.official_support_url ? (
        <Pressable onPress={() => openUrl(guide.official_support_url!)}>
          <Text style={[styles.link, { color: colors.primary }]}>공식 고객센터 열기</Text>
        </Pressable>
      ) : null}
      <Text style={[styles.disclaimer, { color: colors.muted }]}>{guide.disclaimer}</Text>
      {notFound && subscriptionId && onDeleteFromList ? (
        <View style={styles.actions}>
          <View style={{ width: '100%' }}>
            <Text style={[styles.body, { color: colors.muted }]}>
              공식 해지 방법을 못 찾았어요. 실제 해지는 서비스에서 직접 해주셔야 해요 — 일단
              목록에서만 지워드릴까요?
            </Text>
            <Pressable
              onPress={() => onDeleteFromList(subscriptionId)}
              style={[styles.action, { backgroundColor: colors.primary, marginTop: 8 }]}>
              <Text style={[styles.actionLabel, { color: colors.primaryText }]}>목록에서 삭제</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {!notFound && subscriptionId && status !== 'ended' ? (
        <View style={styles.actions}>
          {status === 'active' || status === 'guide_reviewed' ? (
            <>
              {status === 'active' ? (
                <Pressable
                  disabled={busy}
                  onPress={() => void advance('guide_reviewed')}
                  style={[styles.action, { backgroundColor: colors.accent }]}>
                  <Text style={[styles.actionLabel, { color: colors.primary }]}>안내 확인</Text>
                </Pressable>
              ) : null}
              <Pressable
                disabled={busy}
                onPress={() => void advance('cancel_requested')}
                style={[styles.action, { backgroundColor: colors.primary }]}>
                <Text style={[styles.actionLabel, { color: colors.primaryText }]}>해지 신청함</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                disabled={busy}
                onPress={() => void advance('ended')}
                style={[styles.action, { backgroundColor: colors.primary }]}>
                <Text style={[styles.actionLabel, { color: colors.primaryText }]}>종료 확인</Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() => void advance('active')}
                style={[styles.action, { backgroundColor: colors.accent }]}>
                <Text style={[styles.actionLabel, { color: colors.primary }]}>아직 결제됨</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}
      {error ? <Text style={[styles.warning, { color: colors.warning }]}>{error}</Text> : null}
      {citations.length > 0 ? (
        <View style={styles.sources}>
          <Text style={[styles.sourcesLabel, { color: colors.muted }]}>출처</Text>
          {citations.map((citation) => (
            <Pressable key={citation.url} onPress={() => openUrl(citation.url)}>
              <Text style={[styles.link, { color: colors.primary }]} numberOfLines={1}>
                {citation.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 260,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeLabel: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  meta: {
    fontSize: 12,
    fontFamily: fonts.sans,
  },
  step: {
    gap: 4,
  },
  stepTitle: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: fonts.sans,
  },
  body: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.sans,
  },
  warning: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: fonts.sansMedium,
  },
  link: {
    fontSize: 12,
    fontFamily: fonts.sansMedium,
  },
  disclaimer: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: fonts.sans,
  },
  sources: {
    gap: 4,
  },
  sourcesLabel: {
    fontSize: 11,
    fontFamily: fonts.sansMedium,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  action: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
});
