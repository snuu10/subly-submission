const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const UNSUPPORTED_IMAGE_MESSAGE = 'JPEG, PNG 이미지만 올릴 수 있어요.';

// 앱(lib/image-pick.ts)과 동일한 문구 — 한 번에 여러 장을 고르면 재미있게 거절한다.
export const MULTI_RECEIPT_TITLE = '앗, 사진은 한 장만 가능해요! 📸';
export const MULTI_RECEIPT_MESSAGE = '가난한 개발자는 AI 비용이 무서워요… 🥹\n다중 첨부 기능은 곧 업데이트할게요!';

export function sniffImageMediaType(base64?: string | null): AllowedImageType | null {
  if (!base64) return null;
  const head = base64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').slice(0, 16);
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('iVBORw')) return 'image/png';
  return null;
}

export function claudeMediaType(mimeType?: string | null, base64?: string | null): AllowedImageType {
  const sniffed = sniffImageMediaType(base64);
  if (sniffed) return sniffed;
  if (mimeType && (ALLOWED_IMAGE_TYPES as readonly string[]).includes(mimeType)) {
    return mimeType as AllowedImageType;
  }
  return 'image/jpeg';
}

export function extensionFor(mimeType: string, fileName: string): string {
  const fromName = fileName.split('.').pop()?.toLowerCase();
  if (fromName === 'png' || mimeType === 'image/png') return 'png';
  if (fromName === 'jpg' || fromName === 'jpeg') return 'jpg';
  return 'jpg';
}

export type ReceiptImage = {
  file: File;
  base64: string;
  mimeType: AllowedImageType;
  fileName: string;
  previewUrl: string;
};

export async function readReceiptFile(file: File): Promise<ReceiptImage> {
  const looksLikeAllowedName = /\.(jpe?g|png)$/i.test(file.name);
  const declaredType = file.type === 'image/jpg' ? 'image/jpeg' : file.type;
  if (
    declaredType &&
    declaredType.startsWith('image/') &&
    !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(declaredType)
  ) {
    throw new Error(UNSUPPORTED_IMAGE_MESSAGE);
  }
  if (declaredType && !declaredType.startsWith('image/') && !looksLikeAllowedName) {
    throw new Error(UNSUPPORTED_IMAGE_MESSAGE);
  }
  if (!declaredType && !looksLikeAllowedName) {
    throw new Error(UNSUPPORTED_IMAGE_MESSAGE);
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    throw new Error('이미지는 5MB 이하여야 합니다.');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });

  const base64 = dataUrl.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
  if (!base64) {
    throw new Error('이미지를 읽지 못했습니다.');
  }

  const mimeType = sniffImageMediaType(base64);
  if (!mimeType) {
    throw new Error(UNSUPPORTED_IMAGE_MESSAGE);
  }
  const ext = extensionFor(mimeType, file.name);
  const fileName = looksLikeAllowedName ? file.name : `receipt.${ext}`;

  return {
    file,
    base64,
    mimeType,
    fileName,
    previewUrl: dataUrl,
  };
}
