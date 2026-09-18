import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenNav, ScreenShell } from '@/components/ScreenNav';
import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { pickReceiptImage } from '@/lib/image-pick';
import { useReceiptStore } from '@/stores/receipt-store';

export default function ReceiptCaptureScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();

  const handlePick = async (source: 'camera' | 'library') => {
    const picked = await pickReceiptImage(source);
    if (!picked) return;
    useReceiptStore.getState().setCapture(picked);
    router.push('/receipt/analyzing' as Href);
  };

  return (
    <ScreenShell>
      <ScreenNav title="영수증으로 등록" />
      <View style={[styles.body, { paddingBottom: insets.bottom + 20 }]}>
        <View style={[styles.pill, { backgroundColor: colors.accent }]}>
          <Text style={[styles.pillText, { color: colors.primary }]}>Claude AI가 자동으로 인식해요</Text>
        </View>

        <View style={[styles.viewfinder, { borderColor: colors.accent, backgroundColor: colors.accent }]}>
          <SymbolView
            name={{ ios: 'camera', android: 'photo_camera', web: 'photo_camera' }}
            tintColor={colors.muted}
            size={48}
          />
          <Text style={[styles.viewfinderCopy, { color: colors.muted }]}>
            결제 완료 화면을 촬영하거나{'\n'}앨범에서 선택하세요
          </Text>
        </View>

        <Text style={[styles.hint, { color: colors.muted }]}>
          금액·결제일·서비스명이 보이게 찍어주세요
        </Text>

        <View style={styles.actions}>
          <Pressable
            onPress={() => handlePick('camera')}
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}>
            <Text style={[styles.primaryLabel, { color: colors.primaryText }]}>카메라로 촬영</Text>
          </Pressable>
          <Pressable
            onPress={() => handlePick('library')}
            style={[styles.outlineBtn, { borderColor: colors.primary }]}>
            <Text style={[styles.outlineLabel, { color: colors.primary }]}>앨범에서 선택</Text>
          </Pressable>
        </View>
      </View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  pill: {
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  viewfinder: {
    flex: 1,
    maxHeight: 495,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  viewfinderCopy: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    fontFamily: fonts.sans,
  },
  hint: {
    marginTop: 16,
    fontSize: 13,
    textAlign: 'center',
    fontFamily: fonts.sans,
  },
  actions: {
    marginTop: 16,
    gap: 10,
  },
  primaryBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  outlineBtn: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  outlineLabel: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
});
