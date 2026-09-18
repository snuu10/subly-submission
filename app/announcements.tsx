import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import {
  fetchAnnouncements,
  markAnnouncementsRead,
  type Announcement,
} from '@/lib/announcements';
import { formatLongDate } from '@/stores/subscription-store';

const PAGE_SIZE = 20;
const URL_RE = /(https?:\/\/[^\s]+)/g;

async function openUrl(url: string) {
  const can = await Linking.canOpenURL(url);
  if (can) await Linking.openURL(url);
}

function LinkedBody({ body, color, linkColor }: { body: string; color: string; linkColor: string }) {
  const parts = body.split(URL_RE);
  return (
    <Text style={[styles.sheetBody, { color }]}>
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <Text
            key={index}
            style={{ color: linkColor, textDecorationLine: 'underline' }}
            onPress={() => void openUrl(part)}>
            {part}
          </Text>
        ) : (
          <Text key={index}>{part}</Text>
        ),
      )}
    </Text>
  );
}

function relativeLabel(publishedAt: string): string {
  const diffMs = Date.now() - new Date(publishedAt).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  return formatLongDate(publishedAt);
}

function formatFullDate(iso: string): string {
  const date = new Date(iso);
  return `${formatLongDate(iso)} ${date.getHours() < 12 ? '오전' : '오후'} ${
    ((date.getHours() + 11) % 12) + 1
  }시 ${String(date.getMinutes()).padStart(2, '0')}분`;
}

export default function AnnouncementsScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Announcement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Announcement | null>(null);
  const requestedRef = useRef(0);

  useEffect(() => {
    void markAnnouncementsRead();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchAnnouncements(PAGE_SIZE, 0).then(({ items: page, total: pageTotal }) => {
      if (cancelled) return;
      setItems(page);
      setTotal(pageTotal);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || items.length >= total) return;
    setLoadingMore(true);
    const request = ++requestedRef.current;
    const { items: page } = await fetchAnnouncements(PAGE_SIZE, items.length);
    if (request !== requestedRef.current) return;
    setItems((prev) => [...prev, ...page]);
    setLoadingMore(false);
  }, [items.length, loading, loadingMore, total]);

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 120) {
      void loadMore();
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            tintColor={colors.text}
            size={20}
          />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>공지사항</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={200}>
        {!loading && items.length === 0 ? (
          <Text style={[styles.empty, { color: colors.muted }]}>등록된 공지사항이 없어요</Text>
        ) : (
          items.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => setSelected(item)}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.cardTop}>
                {item.tag ? (
                  <View style={[styles.tag, { backgroundColor: colors.accent }]}>
                    <Text style={[styles.tagLabel, { color: colors.primary }]}>{item.tag}</Text>
                  </View>
                ) : null}
                <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                  {item.title}
                </Text>
              </View>
              <Text style={[styles.time, { color: colors.muted }]}>{relativeLabel(item.published_at)}</Text>
            </Pressable>
          ))
        )}
        {loadingMore ? (
          <Text style={[styles.loadingMore, { color: colors.muted }]}>더 불러오는 중…</Text>
        ) : null}
      </ScrollView>

      <Modal
        visible={selected !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setSelected(null)}>
          <Pressable
            style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: insets.bottom + 20 }]}
            onPress={(event) => event.stopPropagation()}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            {selected ? (
              <>
                <View style={styles.sheetHead}>
                  <View style={styles.sheetTitleWrap}>
                    {selected.tag ? (
                      <View style={[styles.tag, { backgroundColor: colors.accent, alignSelf: 'flex-start' }]}>
                        <Text style={[styles.tagLabel, { color: colors.primary }]}>{selected.tag}</Text>
                      </View>
                    ) : null}
                    <Text style={[styles.sheetTitle, { color: colors.text }]}>{selected.title}</Text>
                  </View>
                  <Pressable onPress={() => setSelected(null)} style={styles.sheetClose}>
                    <SymbolView
                      name={{ ios: 'xmark', android: 'close', web: 'close' }}
                      tintColor={colors.muted}
                      size={16}
                    />
                  </Pressable>
                </View>
                <Text style={[styles.sheetDate, { color: colors.muted }]}>
                  {formatFullDate(selected.published_at)}
                </Text>
                <ScrollView style={styles.sheetBodyScroll}>
                  <LinkedBody body={selected.body} color={colors.text} linkColor={colors.primary} />
                </ScrollView>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800' },
  scroll: { flex: 1 },
  content: { padding: 16, gap: 10 },
  empty: { marginTop: 48, textAlign: 'center', fontSize: 14, fontFamily: fonts.sansMedium },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 6 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  tagLabel: { fontSize: 10, fontWeight: '800', fontFamily: fonts.sansExtraBold },
  title: { fontSize: 14, fontWeight: '800', flexShrink: 1 },
  time: { fontSize: 11 },
  loadingMore: { textAlign: 'center', fontSize: 12, paddingVertical: 12 },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    maxHeight: '80%',
    gap: 12,
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 3, alignSelf: 'center', marginBottom: 2 },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  sheetTitleWrap: { flex: 1, gap: 6 },
  sheetTitle: { fontSize: 17, fontWeight: '800', lineHeight: 23 },
  sheetClose: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  sheetDate: { fontSize: 11 },
  sheetBodyScroll: { flexGrow: 0 },
  sheetBody: { fontSize: 14, lineHeight: 22, fontFamily: fonts.sansMedium },
});
