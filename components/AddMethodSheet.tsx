import { router, type Href } from 'expo-router';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { useSubscriptionModal } from '@/contexts/SubscriptionModalContext';
import { useReceiptStore } from '@/stores/receipt-store';

export function AddMethodSheet() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { methodPickerVisible, closeMethodPicker, openAdd } = useSubscriptionModal();

  const handleManual = () => {
    closeMethodPicker();
    openAdd();
  };

  const handleReceipt = () => {
    closeMethodPicker();
    useReceiptStore.getState().reset();
    router.push('/receipt' as Href);
  };

  return (
    <Modal
      visible={methodPickerVisible}
      animationType="slide"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={closeMethodPicker}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={closeMethodPicker} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.surface,
              paddingBottom: Math.max(insets.bottom, 28),
            },
          ]}>
          <View style={styles.handleWrap}>
            <View style={styles.handle} />
          </View>

          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>구독 추가</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>원하는 방법을 선택하세요</Text>
          </View>

          <View style={styles.options}>
            <Pressable
              onPress={handleManual}
              style={[styles.option, { backgroundColor: colors.background }]}>
              <View style={[styles.iconCircle, { backgroundColor: colors.accent }]}>
                <SymbolView
                  name={{ ios: 'pencil', android: 'edit', web: 'edit' }}
                  tintColor={colors.primary}
                  size={18}
                />
              </View>
              <View style={styles.optionCopy}>
                <Text style={[styles.optionTitle, { color: colors.text }]}>직접 입력</Text>
                <Text style={[styles.optionSub, { color: colors.muted }]}>정보를 하나씩 입력해요</Text>
              </View>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                tintColor={colors.muted}
                size={18}
              />
            </Pressable>

            <Pressable
              onPress={handleReceipt}
              style={[styles.option, { backgroundColor: colors.background }]}>
              <View style={[styles.iconCircle, { backgroundColor: colors.roseBg }]}>
                <SymbolView
                  name={{ ios: 'camera', android: 'photo_camera', web: 'photo_camera' }}
                  tintColor={colors.rose}
                  size={18}
                />
                <View style={[styles.aiBadge, { backgroundColor: colors.danger }]}>
                  <Text style={styles.aiBadgeLabel}>AI</Text>
                </View>
              </View>
              <View style={styles.optionCopy}>
                <Text style={[styles.optionTitle, { color: colors.text }]}>영수증으로 등록</Text>
                <Text style={[styles.optionSub, { color: colors.muted }]}>
                  결제 화면 캡처로 자동 인식해요
                </Text>
              </View>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                tintColor={colors.muted}
                size={18}
              />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(17,24,39,0.5)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    minHeight: 360,
    paddingHorizontal: 20,
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D9D9D9',
  },
  header: {
    paddingTop: 10,
    gap: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: fonts.sans,
  },
  options: {
    marginTop: 16,
    gap: 10,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 16,
    borderRadius: 16,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiBadge: {
    position: 'absolute',
    top: -2,
    right: -4,
    minWidth: 22,
    height: 14,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  aiBadgeLabel: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  optionCopy: {
    flex: 1,
    gap: 4,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  optionSub: {
    fontSize: 12,
    fontFamily: fonts.sans,
  },
});
