import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { confirmAction, notify } from '@/lib/confirm';
import {
  disableCurrentDevice,
  getNotificationPermissionStatus,
  isCurrentDevicePushEnabled,
  registerForPushNotifications,
} from '@/lib/notifications';
import {
  type NotificationPreferencePatch,
  useNotificationPreferencesStore,
} from '@/stores/notification-preferences-store';

// ChatGPT 수정: 사용자별 결제 알림·기기 푸시·매너모드를 한 화면에서 관리한다.
type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unsupported';

function timeToDate(value: string): Date {
  const [hour, minute] = value.split(':').map(Number);
  const date = new Date();
  date.setHours(hour || 0, minute || 0, 0, 0);
  return date;
}

function dateToTime(value: Date): string {
  return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:00`;
}

function timeLabel(value: string): string {
  const [hour, minute] = value.split(':').map(Number);
  const period = hour < 12 ? '오전' : '오후';
  const displayHour = hour % 12 || 12;
  return `${period} ${displayHour}:${String(minute || 0).padStart(2, '0')}`;
}

function TimeField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setOpen(false);
    if (event.type === 'dismissed' || !selected) return;
    onChange(dateToTime(selected));
  };

  return (
    <View style={styles.timeBlock}>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[styles.timeRow, { opacity: disabled ? 0.45 : 1 }]}>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
        <View style={[styles.timeValue, { backgroundColor: colors.chip, borderColor: colors.border }]}>
          <Text style={[styles.timeValueText, { color: colors.text }]}>{timeLabel(value)}</Text>
          <SymbolView
            name={{ ios: 'chevron.down', android: 'arrow_drop_down', web: 'arrow_drop_down' }}
            tintColor={colors.muted}
            size={18}
          />
        </View>
      </Pressable>
      {open ? (
        <DateTimePicker
          value={timeToDate(value)}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          minuteInterval={5}
          onChange={handleChange}
        />
      ) : null}
      {Platform.OS === 'ios' && open ? (
        <Pressable onPress={() => setOpen(false)} style={styles.pickerDone}>
          <Text style={[styles.pickerDoneText, { color: colors.primary }]}>완료</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function SettingSwitch({
  label,
  description,
  value,
  disabled,
  onValueChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const colors = useThemeColors();
  return (
    <View style={[styles.settingRow, { opacity: disabled ? 0.45 : 1 }]}>
      <View style={styles.settingCopy}>
        <Text style={[styles.rowLabel, { color: colors.text }]}>{label}</Text>
        {description ? <Text style={[styles.rowDescription, { color: colors.muted }]}>{description}</Text> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        trackColor={{ false: colors.chip, true: colors.primary }}
      />
    </View>
  );
}

export default function NotificationSettingsScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const preferences = useNotificationPreferencesStore((state) => state.preferences);
  const loading = useNotificationPreferencesStore((state) => state.loading);
  const saving = useNotificationPreferencesStore((state) => state.saving);
  const fetchPreferences = useNotificationPreferencesStore((state) => state.fetchPreferences);
  const updatePreferences = useNotificationPreferencesStore((state) => state.updatePreferences);
  const resetPreferences = useNotificationPreferencesStore((state) => state.resetPreferences);
  const [permission, setPermission] = useState<PermissionState>('undetermined');
  const [deviceEnabled, setDeviceEnabled] = useState(false);
  const [deviceBusy, setDeviceBusy] = useState(false);

  const refreshNativeState = useCallback(async () => {
    const [nextPermission, nextDevice] = await Promise.all([
      getNotificationPermissionStatus(),
      isCurrentDevicePushEnabled(),
    ]);
    setPermission(nextPermission as PermissionState);
    setDeviceEnabled(nextDevice);
  }, []);

  useFocusEffect(useCallback(() => {
    void fetchPreferences();
    void refreshNativeState();
  }, [fetchPreferences, refreshNativeState]));

  const save = async (patch: NotificationPreferencePatch) => {
    const ok = await updatePreferences(patch);
    if (!ok) notify('저장 실패', useNotificationPreferencesStore.getState().error ?? '다시 시도해 주세요.');
  };

  const toggleDevice = async (next: boolean) => {
    if (deviceBusy) return;
    setDeviceBusy(true);
    try {
      if (next) {
        const token = await registerForPushNotifications();
        const nextPermission = await getNotificationPermissionStatus();
        await refreshNativeState();
        if (!token) {
          notify(
            '푸시 알림을 켤 수 없음',
            nextPermission === 'denied'
              ? '기기 설정에서 Subly 알림 권한을 허용해 주세요.'
              : '푸시 토큰을 등록하지 못했습니다. 네트워크 상태를 확인해 주세요.'
          );
        }
      } else {
        const disabled = await disableCurrentDevice();
        await refreshNativeState();
        if (!disabled) {
          notify('저장 실패', '현재 기기의 푸시 설정을 끄지 못했습니다. 네트워크 상태를 확인해 주세요.');
        }
      }
    } catch (error) {
      console.warn('[notifications] 현재 기기 설정 변경 실패', error);
      notify('저장 실패', '현재 기기의 푸시 설정을 바꾸지 못했습니다. 다시 시도해 주세요.');
    } finally {
      setDeviceBusy(false);
    }
  };

  const handleReset = async () => {
    const accepted = await confirmAction({
      title: '알림 설정 초기화',
      message: '결제 알림과 매너모드 설정을 기본값으로 되돌릴까요?',
      confirmLabel: '초기화',
      destructive: true,
    });
    if (!accepted) return;
    const ok = await resetPreferences();
    if (!ok) notify('초기화 실패', useNotificationPreferencesStore.getState().error ?? '다시 시도해 주세요.');
  };

  const permissionLabel = permission === 'granted'
    ? '허용됨'
    : permission === 'denied'
    ? '차단됨'
    : permission === 'unsupported'
    ? '지원하지 않음'
    : '아직 선택하지 않음';
  const masterEnabled = preferences?.notifications_enabled ?? true;
  const paymentEnabled = masterEnabled && (preferences?.payment_due_enabled ?? true);

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top + 12 }]}>
        <Pressable accessibilityLabel="뒤로" onPress={() => router.back()} style={styles.backButton}>
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            tintColor={colors.text}
            size={20}
          />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>알림 설정</Text>
        <View style={styles.backButton} />
      </View>

      {loading && !preferences ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}>
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>알림 받기</Text>
            <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <SettingSwitch
                label="알림 받기"
                description="결제 예정 알림의 생성과 표시를 한 번에 관리해요."
                value={masterEnabled}
                disabled={saving}
                onValueChange={(value) => void save({ notifications_enabled: value })}
              />
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.settingRow}>
                <View style={styles.settingCopy}>
                  <Text style={[styles.rowLabel, { color: colors.text }]}>기기 알림 권한</Text>
                  <Text style={[styles.rowDescription, { color: colors.muted }]}>{permissionLabel}</Text>
                </View>
                {permission !== 'granted' && permission !== 'unsupported' ? (
                  <Pressable onPress={() => void Linking.openSettings()} style={styles.textButton}>
                    <Text style={[styles.textButtonLabel, { color: colors.primary }]}>설정 열기</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>결제 알림</Text>
            <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <SettingSwitch
                label="결제 예정 알림"
                value={preferences?.payment_due_enabled ?? true}
                disabled={saving || !masterEnabled}
                onValueChange={(value) => void save({ payment_due_enabled: value })}
              />
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <SettingSwitch
                label="결제 3일 전"
                value={preferences?.payment_due_d3_enabled ?? true}
                disabled={saving || !paymentEnabled}
                onValueChange={(value) => void save({ payment_due_d3_enabled: value })}
              />
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <SettingSwitch
                label="결제 1일 전"
                value={preferences?.payment_due_d1_enabled ?? true}
                disabled={saving || !paymentEnabled}
                onValueChange={(value) => void save({ payment_due_d1_enabled: value })}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>푸시 알림</Text>
            <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <SettingSwitch
                label="모든 기기에서 푸시 받기"
                description="OFF여도 웹과 앱 알림함의 기록은 유지돼요."
                value={preferences?.push_enabled ?? true}
                disabled={saving || !paymentEnabled}
                onValueChange={(value) => void save({ push_enabled: value })}
              />
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <SettingSwitch
                label="이 기기에서 받기"
                description="현재 휴대폰의 푸시 토큰만 켜거나 꺼요."
                value={deviceEnabled}
                disabled={deviceBusy || !paymentEnabled || !(preferences?.push_enabled ?? true)}
                onValueChange={(value) => void toggleDevice(value)}
              />
            </View>
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>매너모드</Text>
            <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <SettingSwitch
                label="알림 소리와 진동 끄기"
                description="정해진 시간에도 알림과 배지는 표시돼요."
                value={preferences?.quiet_hours_enabled ?? false}
                disabled={saving || !paymentEnabled || !(preferences?.push_enabled ?? true)}
                onValueChange={(value) => void save({ quiet_hours_enabled: value })}
              />
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <TimeField
                label="시작 시간"
                value={preferences?.quiet_start ?? '21:00:00'}
                disabled={saving || !(preferences?.quiet_hours_enabled ?? false)}
                onChange={(value) => void save({ quiet_start: value })}
              />
              <TimeField
                label="종료 시간"
                value={preferences?.quiet_end ?? '08:00:00'}
                disabled={saving || !(preferences?.quiet_hours_enabled ?? false)}
                onChange={(value) => void save({ quiet_end: value })}
              />
            </View>
          </View>

          <Pressable
            disabled={saving}
            onPress={() => void handleReset()}
            style={[styles.resetButton, { borderColor: colors.border }]}>
            <Text style={[styles.resetLabel, { color: colors.muted }]}>알림 설정 초기화</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1,
  },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', fontFamily: fonts.sansExtraBold },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, gap: 28 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '800', fontFamily: fonts.sansExtraBold },
  group: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  settingRow: {
    minHeight: 64, paddingHorizontal: 16, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16,
  },
  settingCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowLabel: { fontSize: 15, fontWeight: '700', fontFamily: fonts.sansBold },
  rowDescription: { fontSize: 12, lineHeight: 17, fontFamily: fonts.sans },
  divider: { height: 1, marginHorizontal: 16 },
  textButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  textButtonLabel: { fontSize: 13, fontWeight: '700', fontFamily: fonts.sansBold },
  timeBlock: { paddingVertical: 2 },
  timeRow: {
    minHeight: 58, paddingHorizontal: 16, flexDirection: 'row',
    alignItems: 'center', justifyContent: 'space-between', gap: 16,
  },
  timeValue: {
    minWidth: 132, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12,
    paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  timeValueText: { fontSize: 14, fontFamily: fonts.monoBold },
  pickerDone: { alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  pickerDoneText: { fontSize: 14, fontWeight: '700', fontFamily: fonts.sansBold },
  resetButton: { minHeight: 48, borderWidth: 1, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  resetLabel: { fontSize: 14, fontWeight: '700', fontFamily: fonts.sansBold },
});
