import * as ImagePicker from 'expo-image-picker';

import { notify } from '@/lib/confirm';

export type PickedReceipt = {
  uri: string;
  base64?: string;
  mimeType: string;
  fileName: string;
};

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

const UNSUPPORTED_IMAGE_MESSAGE = 'JPEG, PNG 이미지만 첨부할 수 있어요.';

/**
 * iOS Compatible 변환은 피커 MIME/확장자와 다른 바이트를 줄 수 있다.
 * Claude는 선언한 media_type과 실제 포맷이 다르면 거절한다.
 */
export function sniffImageMediaType(base64?: string | null): AllowedImageType | null {
  if (!base64) return null;
  const head = base64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').slice(0, 16);
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('iVBORw')) return 'image/png';
  return null;
}

function inferMime(uri: string, pickerType?: string | null): string {
  const sniffedHint = pickerType === 'image/jpg' ? 'image/jpeg' : pickerType;
  if (sniffedHint && (ALLOWED_IMAGE_TYPES as readonly string[]).includes(sniffedHint)) {
    return sniffedHint;
  }
  const path = uri.split('?')[0].toLowerCase();
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  return sniffedHint && sniffedHint.startsWith('image/') ? sniffedHint : '';
}

function inferName(uri: string, mimeType: string): string {
  const fromUri = uri.split('/').pop()?.split('?')[0];
  if (fromUri && /\.(jpe?g|png)$/i.test(fromUri)) return fromUri;
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  return `receipt.${ext}`;
}

function isAllowedImageType(mimeType: string | null | undefined): mimeType is AllowedImageType {
  return Boolean(mimeType && (ALLOWED_IMAGE_TYPES as readonly string[]).includes(mimeType));
}

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.7,
  base64: true,
  // 라이브러리에서 여러 장을 고를 수는 있게 두되(허용해야 UI가 자연스럽다),
  // 2장 이상이면 아래에서 재미있게 거절한다 — AI 비용은 장당 과금이라 한 장만 받는다.
  allowsMultipleSelection: true,
  preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

const MULTI_SELECT_TITLE = '앗, 사진은 한 장만 가능해요! 📸';
const MULTI_SELECT_MESSAGE = '가난한 개발자는 AI 비용이 무서워요… 🥹\n다중 첨부 기능은 곧 업데이트할게요!';

export async function pickReceiptImage(source: 'camera' | 'library'): Promise<PickedReceipt | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      notify('카메라 권한', '결제 화면을 촬영하려면 카메라 권한이 필요합니다.');
      return null;
    }
  } else {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      notify('사진 권한', '앨범에서 영수증을 고르려면 사진 권한이 필요합니다.');
      return null;
    }
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
      : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);

  if (result.canceled || !result.assets[0]) return null;

  if (result.assets.length > 1) {
    notify(MULTI_SELECT_TITLE, MULTI_SELECT_MESSAGE);
    return null;
  }

  const asset = result.assets[0];
  const mimeType = sniffImageMediaType(asset.base64) ?? inferMime(asset.uri, asset.mimeType);
  if (!isAllowedImageType(mimeType)) {
    notify('지원하지 않는 형식', UNSUPPORTED_IMAGE_MESSAGE);
    return null;
  }

  return {
    uri: asset.uri,
    base64: asset.base64 ?? undefined,
    mimeType,
    fileName: asset.fileName && /\.(jpe?g|png)$/i.test(asset.fileName)
      ? asset.fileName
      : inferName(asset.uri, mimeType),
  };
}

/** Claude vision에 넘길 MIME. 바이트 스니핑이 있으면 그걸 우선한다. */
export function claudeMediaType(mimeType?: string | null, base64?: string | null): AllowedImageType {
  const sniffed = sniffImageMediaType(base64);
  if (sniffed) return sniffed;
  if (isAllowedImageType(mimeType)) return mimeType;
  return 'image/jpeg';
}
