import { useEffect, useRef, useState } from 'react';

import { invokeClaude } from '@/lib/claude';
import { toParsedSubscription } from '@/lib/extract';
import { readReceiptFile, type ReceiptImage } from '@/lib/image';
import { saveReceiptParse, uploadReceipt } from '@/lib/receipts';
import type { ClaudeExtract, ParsedSubscription } from '@/types/extract';
import type { Category } from '@/types';

export type PendingReceipt = {
  uploadId: string;
  extract: ClaudeExtract;
};

type ReceiptOcrModalProps = {
  categories: Category[];
  onClose: () => void;
  onExtracted: (parsed: ParsedSubscription, pending: PendingReceipt) => void;
};

const ACCEPT = 'image/jpeg,image/png,.jpg,.jpeg,.png';

export function ReceiptOcrModal({ categories, onClose, onExtracted }: ReceiptOcrModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<ReceiptImage | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (image?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(image.previewUrl);
    };
  }, [image]);

  async function applyFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const next = await readReceiptFile(file);
      setImage(next);
    } catch (caught) {
      setImage(null);
      setError(caught instanceof Error ? caught.message : '이미지를 읽지 못했습니다.');
    }
  }

  async function handleAnalyze() {
    if (!image || busy) return;
    if (categories.length === 0) {
      setError('카테고리를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const uploaded = await uploadReceipt(image.file, image.mimeType, image.fileName);
      const response = await invokeClaude({
        mode: 'extract',
        text: '이 결제 화면/영수증에서 구독 정보를 추출하세요.',
        image_base64: image.base64,
        media_type: image.mimeType,
        categories: categories.map((item) => ({ name: item.name, key: item.key })),
      });

      const parsed = response.extract ? toParsedSubscription(response.extract, categories) : null;
      if (!parsed || !response.extract) {
        throw new Error('영수증에서 서비스명과 금액을 찾지 못했어요. 다른 사진으로 시도해 주세요.');
      }

      await saveReceiptParse(uploaded.uploadId, response.extract).catch(() => undefined);
      onExtracted(parsed, { uploadId: uploaded.uploadId, extract: response.extract });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '분석에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-text">영수증으로 등록</h2>
          <button type="button" onClick={onClose} className="text-sm font-semibold text-muted hover:text-text">
            닫기
          </button>
        </div>

        <p className="mb-3 text-sm text-muted">결제 화면이나 영수증 사진을 올리면 AI가 구독 정보를 채워 줘요.</p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => {
            void applyFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />

        <button
          type="button"
          disabled={busy}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void applyFile(event.dataTransfer.files[0]);
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex w-full flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-8 text-center ${
            dragging ? 'border-primary bg-accent' : 'border-border bg-background'
          }`}
        >
          {image ? (
            <>
              <img
                src={image.previewUrl}
                alt="선택한 영수증"
                className="mb-3 h-36 w-full rounded-xl object-cover"
              />
              <p className="text-sm font-semibold text-text">{image.fileName}</p>
              <p className="mt-1 text-xs text-muted">다른 사진을 고르려면 다시 누르세요</p>
            </>
          ) : (
            <>
              <span className="mb-2 flex size-10 items-center justify-center rounded-full bg-accent text-primary">
                <CameraIcon />
              </span>
              <p className="text-sm font-semibold text-text">사진을 끌어다 놓거나 클릭해서 선택</p>
              <p className="mt-1 text-xs text-muted">JPEG, PNG · 최대 5MB</p>
            </>
          )}
        </button>

        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl border border-border px-3 py-2 text-sm font-semibold text-muted hover:text-text"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void handleAnalyze()}
            disabled={!image || busy}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            {busy ? '분석 중…' : '분석하기'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="14" r="3.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
