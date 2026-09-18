import { create } from 'zustand';

import type { PickedReceipt } from '@/lib/image-pick';
import type { ClaudeExtract, ParsedSubscription } from '@/types/extract';

type ReceiptState = {
  imageUri: string | null;
  imageBase64: string | null;
  mimeType: string | null;
  fileName: string | null;
  storagePath: string | null;
  uploadId: string | null;
  extract: ClaudeExtract | null;
  parsed: ParsedSubscription | null;
  setCapture: (picked: PickedReceipt) => void;
  setUpload: (storagePath: string, uploadId: string) => void;
  setResult: (extract: ClaudeExtract | null, parsed: ParsedSubscription | null) => void;
  reset: () => void;
};

const EMPTY: Omit<ReceiptState, 'setCapture' | 'setUpload' | 'setResult' | 'reset'> = {
  imageUri: null,
  imageBase64: null,
  mimeType: null,
  fileName: null,
  storagePath: null,
  uploadId: null,
  extract: null,
  parsed: null,
};

export const useReceiptStore = create<ReceiptState>((set) => ({
  ...EMPTY,

  setCapture: (picked) =>
    set({
      ...EMPTY,
      imageUri: picked.uri,
      imageBase64: picked.base64 ?? null,
      mimeType: picked.mimeType,
      fileName: picked.fileName,
    }),

  setUpload: (storagePath, uploadId) => set({ storagePath, uploadId }),

  setResult: (extract, parsed) => set({ extract, parsed }),

  reset: () => set(EMPTY),
}));
