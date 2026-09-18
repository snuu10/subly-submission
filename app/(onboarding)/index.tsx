import { router, type Href } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  SlideInDown,
} from 'react-native-reanimated';

const FIELD_LAYOUT = LinearTransition.duration(220).easing(Easing.out(Easing.cubic));
import { SafeAreaView } from 'react-native-safe-area-context';

import { useThemeColors } from '@/constants/colors';
import { fonts } from '@/constants/fonts';
import {
  lookupEmailsByName,
  requestPasswordReset,
  resendSignupOtp,
  SIGNUP_OTP_LENGTH,
  SIGNUP_OTP_PATTERN,
  signInWithEmail,
  signUpWithEmail,
  updatePassword,
  verifyRecoveryOtp,
  verifySignupOtp,
} from '@/lib/auth';
import { notify } from '@/lib/confirm';
import { signInWithProvider, type OAuthProvider } from '@/lib/oauth';

type EmailMode = 'signup' | 'login';
type RecoverMode = null | 'find-id' | 'find-pw';
type FindPwStep = 'email' | 'otp' | 'password';
type LoadingState = OAuthProvider | 'email' | 'otp' | 'resend' | 'lookup' | null;
type SignupStep = 0 | 1 | 2 | 3 | 4;
type Phase = 'landing' | 'sequential';
type FieldVariant = 'plain' | 'active' | 'done';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const CONFIRM_STEP: SignupStep = 3;
const CODE_STEP: SignupStep = 4;
const LAST_STEP: SignupStep = 4;
const ALL_STEPS: SignupStep[] = [0, 1, 2, 3, 4];

type FieldMeta = {
  key: string;
  title: string;
  label: string;
  placeholder: string;
};

const FIELDS: FieldMeta[] = [
  { key: 'name', title: '이름을 알려주세요', label: '이름', placeholder: '이름' },
  { key: 'email', title: '이메일을 알려주세요', label: '이메일', placeholder: 'you@example.com' },
  {
    key: 'password',
    title: '비밀번호를 만들어주세요',
    label: '비밀번호',
    placeholder: '8자 이상',
  },
  {
    key: 'passwordConfirm',
    title: '비밀번호를 다시 입력해주세요',
    label: '비밀번호 확인',
    placeholder: '비밀번호 재입력',
  },
  {
    key: 'otp',
    title: '이메일로 받은 인증번호를 입력해주세요',
    label: '인증번호',
    placeholder: '6자리 숫자',
  },
];

// GradientHeroCard와 동일한 값. 앱 전체가 같은 그라데이션을 공유한다.
const BRAND_GRADIENT = ['#4F46E5', '#7C3AED'] as const;
const GRADIENT_START = { x: 0, y: 0 } as const;
const GRADIENT_END = { x: 1, y: 1 } as const;

// SubscriptionRow와 동일한 카드 재질.
const CARD_SHADOW = {
  shadowColor: '#000',
  shadowOpacity: 0.04,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 1,
} as const;

export default function OnboardingScreen() {
  const colors = useThemeColors();
  const [mode, setMode] = useState<EmailMode>('signup');
  const [phase, setPhase] = useState<Phase>('landing');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [otp, setOtp] = useState('');
  const [otpRequestedFor, setOtpRequestedFor] = useState<string | null>(null);
  const [recoverMode, setRecoverMode] = useState<RecoverMode>(null);
  const [findPwStep, setFindPwStep] = useState<FindPwStep>('email');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [foundEmails, setFoundEmails] = useState<string[]>([]);
  const [findIdSearched, setFindIdSearched] = useState(false);
  const [revealedStep, setRevealedStep] = useState<SignupStep>(0);
  const [activeStep, setActiveStep] = useState<SignupStep>(0);
  const [loading, setLoading] = useState<LoadingState>(null);

  const nameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const passwordConfirmRef = useRef<TextInput>(null);
  const otpRef = useRef<TextInput>(null);
  const stepRefs: Array<React.RefObject<TextInput | null>> = [
    nameRef,
    emailRef,
    passwordRef,
    passwordConfirmRef,
    otpRef,
  ];

  const busy = loading !== null;
  const trimmedEmail = email.trim();
  const isNameValid = name.trim().length >= 1;
  const isEmailValid = EMAIL_PATTERN.test(trimmedEmail);
  const isPasswordValid = password.length >= MIN_PASSWORD_LENGTH;
  const isPasswordConfirmValid = passwordConfirm.length > 0 && passwordConfirm === password;
  const isOtpValid = SIGNUP_OTP_PATTERN.test(otp);
  const canSubmitSignup =
    isNameValid && isEmailValid && isPasswordValid && isPasswordConfirmValid && isOtpValid;
  const passwordMismatch = passwordConfirm.length > 0 && passwordConfirm !== password;

  const sequential = mode === 'signup' && phase === 'sequential';
  const recovering = recoverMode !== null;

  const isStepValid = (step: SignupStep) => {
    switch (step) {
      case 0:
        return isNameValid;
      case 1:
        return isEmailValid;
      case 2:
        return isPasswordValid;
      case 3:
        return isPasswordConfirmValid;
      case 4:
        return isOtpValid;
    }
  };

  const titleForStep = (step: SignupStep) => FIELDS[step].title;

  // 필드가 처음 열릴 때만 맨 위에 자리를 잡는다. 이미 열린 필드를 다시 탭해도
  // 순서를 바꾸지 않아야 다른 필드들이 동시에 크기·위치를 바꾸며 겹치는 現상이 없다.
  const [revealOrder, setRevealOrder] = useState<SignupStep[]>([0]);

  useEffect(() => {
    setRevealOrder((prev) => (prev.includes(activeStep) ? prev : [activeStep, ...prev]));
  }, [activeStep]);

  const orderedSteps = useMemo<SignupStep[]>(
    () => revealOrder.filter((step) => step <= revealedStep),
    [revealOrder, revealedStep]
  );

  useEffect(() => {
    if (!sequential) return;

    const input = stepRefs[activeStep];
    if (input?.current?.isFocused()) return;
    const timer = setTimeout(() => input?.current?.focus(), 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep, sequential]);

  const goHome = () => {
    router.replace('/(tabs)/home' as Href);
  };

  const handleEmailSubmit = async () => {
    if (busy) return;

    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      notify('입력 확인', '이메일 형식을 확인해 주세요.');
      return;
    }

    setLoading('email');
    try {
      await signInWithEmail(trimmedEmail, password);
      goHome();
    } catch (err) {
      notify('로그인 실패', err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(null);
    }
  };

  const openCodeStep = () => {
    setRevealedStep(CODE_STEP);
    setActiveStep(CODE_STEP);
  };

  const handleRequestCode = async () => {
    if (busy) return;
    if (!isNameValid) {
      notify('입력 확인', '이름을 입력해 주세요.');
      return;
    }
    if (!isEmailValid) {
      notify('입력 확인', '이메일 형식을 확인해 주세요.');
      return;
    }
    if (!isPasswordValid) {
      notify('입력 확인', '비밀번호는 8자 이상이어야 합니다.');
      return;
    }
    if (!isPasswordConfirmValid) {
      notify('입력 확인', '비밀번호가 일치하지 않습니다.');
      return;
    }

    setLoading('email');
    try {
      if (otpRequestedFor === trimmedEmail) {
        await resendSignupOtp(trimmedEmail);
      } else {
        const result = await signUpWithEmail(trimmedEmail, password, { name: name.trim() });
        if (result.status === 'verified') {
          goHome();
          return;
        }
        setOtpRequestedFor(trimmedEmail);
      }
      setOtp('');
      openCodeStep();
    } catch (err) {
      notify('가입 실패', err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(null);
    }
  };

  const handleVerifyCode = async () => {
    if (busy || !isOtpValid) return;

    setLoading('otp');
    try {
      await verifySignupOtp(trimmedEmail, otp);
      goHome();
    } catch (err) {
      notify('인증 실패', err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(null);
    }
  };

  const handleResendCode = async () => {
    if (busy || !otpRequestedFor) return;

    setLoading('resend');
    try {
      await resendSignupOtp(otpRequestedFor);
      notify('인증번호 발송', '이메일로 인증번호를 다시 보냈습니다.');
    } catch (err) {
      notify('재발송 실패', err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(null);
    }
  };

  // 단계 전진은 이 함수에서만 일어난다. 타이핑은 포커스를 옮기지 않는다.
  const handleCta = () => {
    if (busy) return;

    if (activeStep === CODE_STEP && revealedStep === CODE_STEP) {
      if (canSubmitSignup) void handleVerifyCode();
      return;
    }
    if (activeStep === CONFIRM_STEP && isPasswordConfirmValid) {
      void handleRequestCode();
      return;
    }
    if (!isStepValid(activeStep)) return;

    // 이전 필드를 수정하던 중이면 진행 지점으로 되돌려 준다.
    if (activeStep < revealedStep) {
      setActiveStep(revealedStep);
      return;
    }

    const next = (revealedStep + 1) as SignupStep;
    setRevealedStep(next);
    setActiveStep(next);
  };

  const clearSignupDraft = () => {
    setName('');
    setEmail('');
    setPassword('');
    setPasswordConfirm('');
    setOtp('');
    setOtpRequestedFor(null);
    setRevealedStep(0);
    setActiveStep(0);
    setRevealOrder([0]);
  };

  const resetRecover = () => {
    setRecoverMode(null);
    setFindPwStep('email');
    setFoundEmails([]);
    setFindIdSearched(false);
    setNewPassword('');
    setNewPasswordConfirm('');
    setOtp('');
  };

  const openRecover = (next: RecoverMode) => {
    if (busy) return;
    if (mode === 'signup') clearSignupDraft();
    setRecoverMode(next);
    setFindPwStep('email');
    setFoundEmails([]);
    setFindIdSearched(false);
    setNewPassword('');
    setNewPasswordConfirm('');
    setOtp('');
  };

  const handleFindId = async () => {
    if (busy) return;
    if (!isNameValid) {
      notify('입력 확인', '이름을 입력해 주세요.');
      return;
    }
    setLoading('lookup');
    try {
      const emails = await lookupEmailsByName(name);
      setFoundEmails(emails);
      setFindIdSearched(true);
    } catch (err) {
      notify('아이디 찾기 실패', err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(null);
    }
  };

  const handleRequestReset = async () => {
    if (busy) return;
    if (!isEmailValid) {
      notify('입력 확인', '이메일 형식을 확인해 주세요.');
      return;
    }
    setLoading('email');
    try {
      await requestPasswordReset(trimmedEmail);
      setOtp('');
      setFindPwStep('otp');
    } catch (err) {
      notify('발송 실패', err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(null);
    }
  };

  const handleVerifyReset = async () => {
    if (busy || !isOtpValid) return;
    setLoading('otp');
    try {
      await verifyRecoveryOtp(trimmedEmail, otp);
      setFindPwStep('password');
    } catch (err) {
      notify('인증 실패', err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(null);
    }
  };

  const handleSaveNewPassword = async () => {
    if (busy) return;
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      notify('입력 확인', '비밀번호는 8자 이상이어야 합니다.');
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      notify('입력 확인', '비밀번호가 일치하지 않습니다.');
      return;
    }
    setLoading('email');
    try {
      await updatePassword(newPassword);
      goHome();
    } catch (err) {
      notify('변경 실패', err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(null);
    }
  };

  const handleResendReset = async () => {
    if (busy) return;
    setLoading('resend');
    try {
      await requestPasswordReset(trimmedEmail);
      notify('인증번호 발송', '이메일로 인증번호를 다시 보냈습니다.');
    } catch (err) {
      notify('재발송 실패', err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(null);
    }
  };

  const handleBack = () => {
    if (busy) return;

    if (recovering) {
      if (recoverMode === 'find-pw' && findPwStep === 'password') {
        setFindPwStep('otp');
        return;
      }
      if (recoverMode === 'find-pw' && findPwStep === 'otp') {
        setFindPwStep('email');
        return;
      }
      resetRecover();
      return;
    }

    if (activeStep > 0) {
      setActiveStep((activeStep - 1) as SignupStep);
      return;
    }

    nameRef.current?.blur();
    Keyboard.dismiss();
    if (mode === 'signup') clearSignupDraft();
    setPhase('landing');
  };

  useEffect(() => {
    // web의 BackHandler는 호출만 해도 console.error를 남기므로 네이티브에서만 붙인다.
    if ((!sequential && !recovering) || Platform.OS === 'web') return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleBack();
      return true;
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequential, recovering, findPwStep, activeStep, busy]);

  const handleModeToggle = () => {
    if (busy) return;
    setPhase('landing');
    clearSignupDraft();
    resetRecover();
    setMode((current) => (current === 'signup' ? 'login' : 'signup'));
  };

  const handleSocialLogin = async (provider: OAuthProvider) => {
    if (busy) return;
    setLoading(provider);

    try {
      const session = await signInWithProvider(provider);
      if (session) {
        goHome();
      }
    } catch (err) {
      notify(
        '로그인 실패',
        err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.'
      );
    } finally {
      setLoading(null);
    }
  };

  const stepInputProps: TextInputProps[] = [
    { autoCapitalize: 'words', textContentType: 'name' },
    {
      autoCapitalize: 'none',
      autoCorrect: false,
      keyboardType: 'email-address',
      textContentType: 'emailAddress',
    },
    { secureTextEntry: true, textContentType: 'newPassword' },
    { secureTextEntry: true, textContentType: 'newPassword' },
    {
      autoCapitalize: 'none',
      autoCorrect: false,
      keyboardType: 'number-pad',
      maxLength: SIGNUP_OTP_LENGTH,
      textContentType: 'oneTimeCode',
      autoComplete: 'one-time-code',
    },
  ];

  const handleOtpChange = (value: string) => {
    setOtp(value.replace(/\D/g, '').slice(0, SIGNUP_OTP_LENGTH));
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (otpRequestedFor && value.trim() !== otpRequestedFor) {
      setOtp('');
      setOtpRequestedFor(null);
    }
  };

  const stepValues = [name, email, password, passwordConfirm, otp];
  const stepSetters = [setName, handleEmailChange, setPassword, setPasswordConfirm, handleOtpChange];

  const renderField = (step: SignupStep, variant: FieldVariant) => {
    const field = FIELDS[step];
    const isDone = variant === 'done';
    const showMismatch = step === 3 && variant === 'active' && passwordMismatch;

    return (
      <Animated.View
        key={field.key}
        layout={FIELD_LAYOUT}
        entering={FadeIn.duration(180)}
        style={[styles.fieldBlock, isDone ? styles.fieldBlockDone : null]}>
        {variant === 'plain' ? null : (
          <Text
            style={[
              styles.fieldLabel,
              { color: variant === 'active' ? colors.primary : colors.muted },
            ]}>
            {field.label}
          </Text>
        )}
        <TextInput
          ref={stepRefs[step] ?? undefined}
          value={stepValues[step]}
          onChangeText={stepSetters[step]}
          onFocus={() => {
            setPhase('sequential');
            setActiveStep(step);
          }}
          placeholder={field.placeholder}
          placeholderTextColor={colors.muted}
          editable={!busy}
          returnKeyType={step === LAST_STEP ? 'done' : 'next'}
          submitBehavior={step === LAST_STEP ? 'blurAndSubmit' : 'submit'}
          onSubmitEditing={handleCta}
          {...stepInputProps[step]}
          style={
            isDone
              ? [styles.doneInput, { color: colors.text, borderBottomColor: colors.border }]
              : [
                  styles.input,
                  {
                    color: colors.text,
                    backgroundColor: colors.surface,
                    borderColor: showMismatch
                      ? colors.danger
                      : variant === 'active'
                        ? colors.primary
                        : colors.border,
                  },
                ]
          }
        />
        {showMismatch ? (
          <Text style={[styles.fieldError, { color: colors.danger }]}>
            비밀번호가 일치하지 않습니다
          </Text>
        ) : null}
        {step === CODE_STEP && variant === 'active' && otpRequestedFor ? (
          <Pressable onPress={() => void handleResendCode()} disabled={busy} hitSlop={8}>
            <Text style={[styles.resendLabel, { color: colors.primary }]}>인증번호 다시 받기</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    );
  };

  const ctaLabel =
    activeStep === CODE_STEP
      ? '인증하기'
      : activeStep === CONFIRM_STEP
        ? otpRequestedFor === trimmedEmail
          ? '인증번호 다시 받기'
          : '인증번호 받기'
        : '확인';
  const ctaDisabled =
    busy || (activeStep === CODE_STEP ? !canSubmitSignup : !isStepValid(activeStep));

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Animated.View
          pointerEvents={sequential || recovering ? 'auto' : 'none'}
          style={[styles.backHeader, { opacity: sequential || recovering ? 1 : 0 }]}>
          <Pressable
            onPress={handleBack}
            disabled={busy || !(sequential || recovering)}
            hitSlop={12}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="뒤로">
            <SymbolView
              name={{ ios: 'chevron.left', android: 'arrow_back', web: 'arrow_back' }}
              tintColor={colors.text}
              size={22}
            />
          </Pressable>
        </Animated.View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled">
          <Animated.View layout={LinearTransition.duration(240)} style={styles.headerSlot}>
            {recovering ? (
              <Animated.View
                key={`recover-${recoverMode}-${findPwStep}`}
                entering={FadeIn.duration(200)}
                style={styles.stepCopy}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>
                  {recoverMode === 'find-id'
                    ? '아이디 찾기'
                    : findPwStep === 'otp'
                      ? '이메일로 받은 인증번호를 입력해주세요'
                      : findPwStep === 'password'
                        ? '새 비밀번호를 만들어주세요'
                        : '비밀번호 찾기'}
                </Text>
              </Animated.View>
            ) : sequential ? (
              <Animated.View
                key={`step-${activeStep}`}
                entering={FadeIn.duration(200)}
                exiting={FadeOut.duration(160)}
                style={styles.stepCopy}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>
                  {titleForStep(activeStep)}
                </Text>
              </Animated.View>
            ) : (
              <Animated.View
                key="landing-copy"
                entering={FadeIn.duration(220)}
                exiting={FadeOut.duration(180)}
                style={styles.copy}>
                <View style={styles.brandRow}>
                  <Image
                    source={require('../../assets/images/brand-mark.png')}
                    style={styles.brandMark}
                    resizeMode="contain"
                    accessible={false}
                  />
                  <Text style={[styles.brand, { color: colors.primary }]}>subly</Text>
                </View>
                <Text style={[styles.title, { color: colors.text }]}>
                  구독 지출,{'\n'}30초면 정리됩니다
                </Text>
                <Text style={[styles.subtitle, { color: colors.muted }]}>
                  계좌 연결 없이, 쓰는 구독만 골라 등록하세요
                </Text>
              </Animated.View>
            )}
          </Animated.View>

          {sequential || recovering ? null : (
            <Animated.View
              layout={LinearTransition.duration(240)}
              exiting={FadeOut.duration(160)}
              style={styles.spacer}
            />
          )}

          <Animated.View layout={LinearTransition.duration(240)} style={styles.fields}>
            {recoverMode === 'find-id' ? (
              <>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="이름"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="words"
                  textContentType="name"
                  editable={!busy}
                  style={[
                    styles.input,
                    { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
                  ]}
                />
                <PrimaryButton
                  label="찾기"
                  onPress={() => void handleFindId()}
                  disabled={busy || !isNameValid}
                  loading={loading === 'lookup'}
                />
                {findIdSearched && foundEmails.length === 0 ? (
                  <Text style={[styles.foundEmail, { color: colors.muted }]}>
                    일치하는 계정이 없습니다
                  </Text>
                ) : null}
                {foundEmails.map((item) => (
                  <Text key={item} style={[styles.foundEmail, { color: colors.text }]}>
                    {item}
                  </Text>
                ))}
              </>
            ) : recoverMode === 'find-pw' && findPwStep === 'email' ? (
              <>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="이메일"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  editable={!busy}
                  style={[
                    styles.input,
                    { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
                  ]}
                />
                <PrimaryButton
                  label="인증번호 받기"
                  onPress={() => void handleRequestReset()}
                  disabled={busy || !isEmailValid}
                  loading={loading === 'email'}
                />
              </>
            ) : recoverMode === 'find-pw' && findPwStep === 'otp' ? (
              <>
                <TextInput
                  value={otp}
                  onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, SIGNUP_OTP_LENGTH))}
                  placeholder="6자리 숫자"
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                  maxLength={SIGNUP_OTP_LENGTH}
                  textContentType="oneTimeCode"
                  editable={!busy}
                  style={[
                    styles.input,
                    { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
                  ]}
                />
                <Pressable onPress={() => void handleResendReset()} disabled={busy}>
                  <Text style={[styles.resendLabel, { color: colors.primary }]}>인증번호 다시 받기</Text>
                </Pressable>
                <PrimaryButton
                  label="인증하기"
                  onPress={() => void handleVerifyReset()}
                  disabled={busy || !isOtpValid}
                  loading={loading === 'otp'}
                />
              </>
            ) : recoverMode === 'find-pw' && findPwStep === 'password' ? (
              <>
                <TextInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="새 비밀번호 (8자 이상)"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  textContentType="newPassword"
                  editable={!busy}
                  style={[
                    styles.input,
                    { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
                  ]}
                />
                <TextInput
                  value={newPasswordConfirm}
                  onChangeText={setNewPasswordConfirm}
                  placeholder="새 비밀번호 확인"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  textContentType="newPassword"
                  editable={!busy}
                  style={[
                    styles.input,
                    { color: colors.text, borderColor: colors.border, backgroundColor: colors.surface },
                  ]}
                />
                <PrimaryButton
                  label="비밀번호 변경"
                  onPress={() => void handleSaveNewPassword()}
                  disabled={
                    busy ||
                    newPassword.length < MIN_PASSWORD_LENGTH ||
                    newPassword !== newPasswordConfirm
                  }
                  loading={loading === 'email'}
                />
              </>
            ) : mode === 'signup' ? (
              // landing에서도 같은 배열 위치·key를 유지해 TextInput 인스턴스가 살아남는다.
              (sequential ? orderedSteps : ([0] as SignupStep[])).map((step) =>
                renderField(step, !sequential ? 'plain' : step === activeStep ? 'active' : 'done')
              )
            ) : (
              <>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="이메일"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  editable={!busy}
                  style={[
                    styles.input,
                    {
                      color: colors.text,
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                    },
                  ]}
                />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="비밀번호 (8자 이상)"
                  placeholderTextColor={colors.muted}
                  secureTextEntry
                  textContentType="password"
                  editable={!busy}
                  style={[
                    styles.input,
                    {
                      color: colors.text,
                      borderColor: colors.border,
                      backgroundColor: colors.surface,
                    },
                  ]}
                />
                <PrimaryButton
                  label="로그인"
                  onPress={handleEmailSubmit}
                  disabled={busy}
                  loading={loading === 'email'}
                />
                <View style={styles.recoverRow}>
                  <Pressable onPress={() => openRecover('find-id')} disabled={busy}>
                    <Text style={[styles.recoverLink, { color: colors.muted }]}>아이디 찾기</Text>
                  </Pressable>
                  <Text style={[styles.recoverDot, { color: colors.border }]}>|</Text>
                  <Pressable onPress={() => openRecover('find-pw')} disabled={busy}>
                    <Text style={[styles.recoverLink, { color: colors.muted }]}>비밀번호 찾기</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Animated.View>

          {sequential || recovering ? null : (
            <Animated.View
              key="landing-options"
              entering={FadeIn.duration(220)}
              exiting={FadeOut.duration(140)}
              style={styles.options}>
              <Pressable onPress={handleModeToggle} disabled={busy} style={styles.switchMode}>
                <Text style={[styles.switchModeLabel, { color: colors.muted }]}>
                  {mode === 'signup' ? '이미 계정이 있나요? 로그인' : '처음이신가요? 가입하기'}
                </Text>
              </Pressable>

              <View style={styles.dividerRow}>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
                <Text style={[styles.dividerLabel, { color: colors.muted }]}>또는</Text>
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              </View>

              <Pressable
                onPress={() => handleSocialLogin('kakao')}
                disabled={busy}
                style={[styles.button, styles.kakaoButton, busy ? styles.buttonDisabled : null]}>
                {loading === 'kakao' ? (
                  <ActivityIndicator color="#191919" />
                ) : (
                  <View style={styles.googleLabelRow}>
                    <KakaoMark />
                    <Text style={[styles.buttonLabel, styles.kakaoLabel]}>카카오로 시작하기</Text>
                  </View>
                )}
              </Pressable>

              <Pressable
                onPress={() => handleSocialLogin('google')}
                disabled={busy}
                style={[
                  styles.button,
                  styles.googleButton,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                  busy ? styles.buttonDisabled : null,
                ]}>
                {loading === 'google' ? (
                  <ActivityIndicator color={colors.text} />
                ) : (
                  <View style={styles.googleLabelRow}>
                    <GoogleMark />
                    <Text style={[styles.buttonLabel, { color: colors.text }]}>
                      Google로 시작하기
                    </Text>
                  </View>
                )}
              </Pressable>

              <Text style={[styles.helper, { color: colors.muted }]}>
                카카오·Google 또는 이메일로 시작합니다
              </Text>
            </Animated.View>
          )}
        </ScrollView>

        {sequential ? (
          <Animated.View
            entering={SlideInDown.duration(220)}
            style={[styles.ctaBar, { borderTopColor: colors.border }]}>
            <PrimaryButton
              label={ctaLabel}
              onPress={handleCta}
              disabled={ctaDisabled}
              loading={loading === 'email' || loading === 'otp' || loading === 'resend'}
            />
          </Animated.View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function KakaoMark() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Path
        fill="#191919"
        d="M12 3C6.48 3 2 6.48 2 10.78c0 2.75 1.84 5.17 4.62 6.55-.2.75-.73 2.72-.84 3.14-.13.51.19.5.4.37.16-.11 2.6-1.76 3.66-2.48.68.1 1.39.15 2.16.15 5.52 0 10-3.48 10-7.73C22 6.48 17.52 3 12 3z"
      />
    </Svg>
  );
}

function GoogleMark() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  loading: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.gradientButton, disabled ? styles.buttonDisabled : null]}>
      <LinearGradient
        colors={BRAND_GRADIENT}
        start={GRADIENT_START}
        end={GRADIENT_END}
        style={styles.gradientFill}>
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={[styles.buttonLabel, styles.gradientLabel]}>{label}</Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 24,
    paddingTop: 24,
    gap: 28,
  },
  backHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 2,
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    gap: 16,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandMark: {
    width: 44,
    height: 44,
  },
  brand: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.4,
    fontFamily: fonts.sansBold,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 42,
    letterSpacing: -0.5,
    fontFamily: fonts.sansExtraBold,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: fonts.sans,
  },
  spacer: {
    flex: 1,
  },
  headerSlot: {
    overflow: 'hidden',
  },
  stepCopy: {
    gap: 8,
    paddingLeft: 40,
  },
  stepTitle: {
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 34,
    letterSpacing: -0.5,
    fontFamily: fonts.sansExtraBold,
  },
  fields: {
    gap: 12,
  },
  fieldBlock: {
    gap: 6,
  },
  fieldBlockDone: {
    opacity: 0.62,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 4,
    fontFamily: fonts.sansMedium,
  },
  fieldError: {
    fontSize: 12,
    paddingHorizontal: 4,
    fontFamily: fonts.sansMedium,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontFamily: fonts.sans,
    ...CARD_SHADOW,
  },
  doneInput: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    fontSize: 15,
    paddingHorizontal: 4,
    paddingVertical: 8,
    fontFamily: fonts.sans,
  },
  resendLabel: {
    fontSize: 13,
    paddingHorizontal: 4,
    paddingTop: 8,
    fontFamily: fonts.sansMedium,
  },
  recoverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingTop: 4,
  },
  recoverLink: {
    fontSize: 13,
    fontFamily: fonts.sansMedium,
  },
  recoverDot: {
    fontSize: 13,
  },
  foundEmail: {
    fontSize: 16,
    textAlign: 'center',
    fontFamily: fonts.sansBold,
    fontWeight: '700',
  },
  options: {
    gap: 10,
  },
  ctaBar: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  gradientButton: {
    borderRadius: 16,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  gradientFill: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    paddingVertical: 16,
  },
  gradientLabel: {
    color: '#FFFFFF',
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    minHeight: 52,
    paddingVertical: 16,
    ...CARD_SHADOW,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  kakaoButton: {
    backgroundColor: '#FEE500',
  },
  googleButton: {
    borderWidth: 1,
  },
  googleLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: fonts.sansBold,
  },
  kakaoLabel: {
    color: '#191919',
  },
  switchMode: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  switchModeLabel: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: fonts.sansMedium,
  },
  dividerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginVertical: 6,
  },
  divider: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerLabel: {
    fontSize: 13,
    fontFamily: fonts.sans,
  },
  helper: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 4,
    fontFamily: fonts.sans,
  },
});
