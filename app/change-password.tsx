import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import { changePassword } from '@/lib/auth';
import { notify } from '@/lib/confirm';
import { useAuthStore } from '@/stores/auth-store';

const MIN_PASSWORD_LENGTH = 8;

export default function ChangePasswordScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const email = useAuthStore((state) => state.session?.user.email ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const mismatch = confirmPassword.length > 0 && confirmPassword !== nextPassword;
  const canSave =
    currentPassword.length > 0 &&
    nextPassword.length >= MIN_PASSWORD_LENGTH &&
    nextPassword === confirmPassword &&
    !saving;

  const handleSave = async () => {
    if (!canSave || !email) return;
    setSaving(true);
    try {
      await changePassword(email, currentPassword, nextPassword);
      notify('변경 완료', '비밀번호가 바뀌었습니다.');
      router.back();
    } catch (err) {
      notify('변경 실패', err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View
        style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <SymbolView
            name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
            tintColor={colors.text}
            size={20}
          />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>비밀번호 변경</Text>
        <View style={styles.backButton} />
      </View>

      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.content}>
        <TextInput
          value={currentPassword}
          onChangeText={setCurrentPassword}
          placeholder="현재 비밀번호"
          placeholderTextColor={colors.muted}
          secureTextEntry
          textContentType="password"
          editable={!saving}
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
          ]}
        />
        <TextInput
          value={nextPassword}
          onChangeText={setNextPassword}
          placeholder="새 비밀번호 (8자 이상)"
          placeholderTextColor={colors.muted}
          secureTextEntry
          textContentType="newPassword"
          editable={!saving}
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
          ]}
        />
        <TextInput
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="새 비밀번호 확인"
          placeholderTextColor={colors.muted}
          secureTextEntry
          textContentType="newPassword"
          editable={!saving}
          style={[
            styles.input,
            {
              color: colors.text,
              borderColor: mismatch ? colors.danger : colors.border,
              backgroundColor: colors.surface,
            },
          ]}
        />
        {mismatch ? (
          <Text style={[styles.error, { color: colors.danger }]}>비밀번호가 일치하지 않습니다</Text>
        ) : null}
        <Pressable
          onPress={() => void handleSave()}
          disabled={!canSave}
          style={[
            styles.save,
            { backgroundColor: colors.primary },
            !canSave ? styles.saveDisabled : null,
          ]}>
          <Text style={[styles.saveLabel, { color: colors.primaryText }]}>
            {saving ? '변경 중…' : '변경'}
          </Text>
        </Pressable>
      </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '800',
    fontFamily: fonts.sansExtraBold,
  },
  content: {
    padding: 20,
    gap: 12,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontFamily: fonts.sans,
  },
  error: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
  save: {
    alignItems: 'center',
    borderRadius: 14,
    minHeight: 52,
    justifyContent: 'center',
    marginTop: 8,
  },
  saveDisabled: {
    opacity: 0.6,
  },
  saveLabel: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
});
