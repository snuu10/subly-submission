import { Alert, Platform } from 'react-native';

/**
 * react-native-web의 Alert.alert은 본문이 빈 함수라 웹에서 다이얼로그가 뜨지 않는다.
 * 확인 콜백 안에 로직을 두면 웹에서 조용히 무시되므로 플랫폼별 구현을 여기로 모은다.
 */

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
};

export function confirmAction({
  title,
  message,
  confirmLabel,
  cancelLabel = '취소',
  destructive = false,
}: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return Promise.resolve(false);
    return Promise.resolve(window.confirm(message));
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
        {
          text: confirmLabel,
          style: destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}

export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }

  Alert.alert(title, message);
}
