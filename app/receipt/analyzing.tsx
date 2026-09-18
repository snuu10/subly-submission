import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { ScreenNav, ScreenShell } from '@/components/ScreenNav';
import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { invokeClaude } from '@/lib/claude';
import { notify } from '@/lib/confirm';
import { toParsedSubscription } from '@/lib/extract';
import { claudeMediaType } from '@/lib/image-pick';
import { saveReceiptParse, uploadReceipt } from '@/lib/receipts';
import { useCategoryStore } from '@/stores/category-store';
import { useReceiptStore } from '@/stores/receipt-store';

let analyzingUri: string | null = null;

export default function ReceiptAnalyzingScreen() {
  const colors = useThemeColors();
  const imageUri = useReceiptStore((state) => state.imageUri);

  useEffect(() => {
    const run = async () => {
      const receipt = useReceiptStore.getState();
      if (!receipt.imageUri) {
        router.replace('/receipt' as Href);
        return;
      }
      if (analyzingUri === receipt.imageUri) return;
      analyzingUri = receipt.imageUri;

      try {
        const picked = {
          uri: receipt.imageUri,
          base64: receipt.imageBase64 ?? undefined,
          mimeType: receipt.mimeType ?? 'image/jpeg',
          fileName: receipt.fileName ?? 'receipt.jpg',
        };

        const uploaded = await uploadReceipt(picked);
        useReceiptStore.getState().setUpload(uploaded.storagePath, uploaded.uploadId);

        const categories = useCategoryStore.getState().categories;
        const response = await invokeClaude({
          mode: 'extract',
          text: '이 결제 화면/영수증에서 구독 정보를 추출하세요.',
          image_base64: picked.base64,
          media_type: claudeMediaType(picked.mimeType, picked.base64),
          categories: categories.map((item) => ({ name: item.name, key: item.key })),
        });

        const parsed = response.extract ? toParsedSubscription(response.extract, categories) : null;
        if (!parsed) {
          throw new Error('영수증에서 서비스명과 금액을 찾지 못했어요. 다른 사진으로 시도해 주세요.');
        }

        useReceiptStore.getState().setResult(response.extract, parsed);
        await saveReceiptParse(uploaded.uploadId, response.extract);
        router.replace('/receipt/confirm' as Href);
      } catch (error) {
        notify('분석 실패', error instanceof Error ? error.message : '다시 시도해 주세요.');
        analyzingUri = null;
        router.replace('/receipt' as Href);
      }
    };

    void run();
  }, []);

  return (
    <ScreenShell>
      <ScreenNav title="영수증으로 등록" />
      <View style={styles.body}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, { backgroundColor: colors.accent }]} />
        )}
        <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
        <Text style={[styles.title, { color: colors.text }]}>영수증을 분석하고 있어요</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>잠깐만 기다려주세요</Text>
        <View style={[styles.skeleton, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.bar, styles.barWide, { backgroundColor: colors.accent }]} />
          <View style={[styles.bar, styles.barMid, { backgroundColor: colors.accent }]} />
          <View style={[styles.bar, styles.barShort, { backgroundColor: colors.accent }]} />
          <View style={[styles.bar, styles.barWide, { backgroundColor: colors.accent }]} />
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 48,
  },
  thumb: {
    width: 220,
    height: 140,
    borderRadius: 16,
    marginBottom: 20,
  },
  spinner: {
    marginBottom: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  sub: {
    fontSize: 13,
    marginTop: 6,
    fontFamily: fonts.sans,
  },
  skeleton: {
    width: '100%',
    marginTop: 28,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  bar: {
    height: 12,
    borderRadius: 6,
  },
  barWide: {
    width: '92%',
  },
  barMid: {
    width: '72%',
  },
  barShort: {
    width: '58%',
  },
});
