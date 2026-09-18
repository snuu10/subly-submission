import { useMemo, useState, type FormEvent, type ReactNode } from 'react';

import { findInstitution, institutionsFor } from '@/lib/financial-institutions';
import { last4FromNumber } from '@/lib/payment-instrument';
import type {
  PaymentCardType,
  PaymentClassification,
  PaymentInstrument,
  PaymentInstrumentKind,
  PaymentInstrumentStatus,
  PaymentInstrumentWrite,
} from '@/types/payment-instrument';
import {
  PAYMENT_CARD_TYPE_LABEL,
  PAYMENT_CARD_TYPE_OPTIONS,
  PAYMENT_CLASSIFICATION_LABEL,
  PAYMENT_CLASSIFICATION_OPTIONS,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_OPTIONS,
} from '@/types/payment-instrument';

export const STATUS_CHIP: Record<PaymentInstrumentStatus, string> = {
  in_use: 'bg-emerald-50 text-success',
  unused: 'bg-background text-muted',
  undecided: 'bg-amber-bg text-amber',
  expired: 'bg-rose-bg text-rose',
};

export const CLASS_CHIP: Record<PaymentClassification, string> = {
  personal: 'bg-rose-bg text-rose',
  corporate: 'bg-accent text-primary',
};

export const TYPE_CHIP: Record<PaymentCardType, string> = {
  credit: 'bg-rose-bg text-rose',
  check: 'bg-accent text-primary',
};

export function InstitutionPicker({
  classification,
  onClassification,
  onBack,
  onSelect,
  framed = true,
}: {
  classification: PaymentClassification;
  onClassification: (value: PaymentClassification) => void;
  onBack: () => void;
  onSelect: (kind: PaymentInstrumentKind, key: string) => void;
  framed?: boolean;
}) {
  return (
    <section className={framed ? 'rounded-2xl border border-border bg-surface p-5 md:p-6' : undefined}>
      <button type="button" onClick={onBack} className="text-sm font-semibold text-muted hover:text-text">
        ← 목록
      </button>
      <h2 className="mt-3 text-2xl font-extrabold text-text">어떤 자산을 연결할까요?</h2>
      <p className="mt-1 text-sm text-muted">개인 또는 법인을 고른 뒤 은행·카드사를 선택하세요.</p>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {PAYMENT_CLASSIFICATION_OPTIONS.map((option) => {
          const selected = classification === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onClassification(option.value)}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-4 text-left ${
                selected ? 'border-primary bg-accent' : 'border-border bg-background'
              }`}
            >
              <span
                className={`flex size-5 items-center justify-center rounded-full border-2 ${
                  selected ? 'border-primary' : 'border-border'
                }`}
              >
                {selected ? <span className="size-2.5 rounded-full bg-primary" /> : null}
              </span>
              <span className="text-sm font-bold text-text">
                {option.value === 'corporate' ? '기업고객 (법인)' : '개인고객 (개인)'}
              </span>
            </button>
          );
        })}
      </div>

      <h3 className="mt-8 text-base font-extrabold text-text">은행</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {institutionsFor('bank').map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect('bank', item.key)}
            className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-background px-2 py-4 shadow-sm hover:border-primary"
          >
            <img src={item.icon} alt="" className="size-10 object-contain" />
            <span className="text-center text-xs font-bold text-text">{item.name}</span>
          </button>
        ))}
      </div>

      <h3 className="mt-8 text-base font-extrabold text-text">카드</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {institutionsFor('card').map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect('card', item.key)}
            className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-background px-2 py-4 shadow-sm hover:border-primary"
          >
            <img src={item.icon} alt="" className="size-10 object-contain" />
            <span className="text-center text-xs font-bold text-text">{item.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function InstrumentForm({
  kind,
  institutionKey,
  classification,
  editing,
  saving,
  onClassification,
  onChangeInstitution,
  onCancel,
  onSave,
  onDelete,
  framed = true,
  defaultCardType,
}: {
  kind: PaymentInstrumentKind;
  institutionKey: string;
  classification: PaymentClassification;
  editing: PaymentInstrument | null;
  saving: boolean;
  onClassification: (value: PaymentClassification) => void;
  onChangeInstitution: () => void;
  onCancel: () => void;
  onSave: (input: PaymentInstrumentWrite) => Promise<void>;
  onDelete?: () => Promise<void>;
  framed?: boolean;
  defaultCardType?: PaymentCardType | null;
}) {
  const institution = findInstitution(kind, institutionKey);
  const [name, setName] = useState(editing?.name ?? '');
  const [number, setNumber] = useState(editing?.number_last4 ?? '');
  const [parts, setParts] = useState(['', '', '', editing?.number_last4 ?? '']);
  const [status, setStatus] = useState<PaymentInstrumentStatus>(editing?.status ?? 'in_use');
  const [cardType, setCardType] = useState<PaymentCardType>(editing?.card_type ?? defaultCardType ?? 'credit');
  const [expiryMonth, setExpiryMonth] = useState(editing?.expiry_month ? String(editing.expiry_month) : '');
  const [expiryYear, setExpiryYear] = useState(editing?.expiry_year ? String(editing.expiry_year) : '');
  const [memo, setMemo] = useState(editing?.memo ?? '');
  const [error, setError] = useState<string | null>(null);

  const years = useMemo(() => {
    const start = new Date().getFullYear();
    return Array.from({ length: 16 }, (_, index) => start + index);
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const last4 = last4FromNumber(kind === 'card' ? parts.join('') : number);
    if (!name.trim()) {
      setError(kind === 'bank' ? '계좌 이름을 입력해 주세요.' : '카드 이름을 입력해 주세요.');
      return;
    }
    if (!last4) {
      setError('번호 뒤 4자리가 필요합니다.');
      return;
    }
    setError(null);
    await onSave({
      kind,
      institution_key: institutionKey,
      name: name.trim(),
      number_last4: last4,
      status,
      classification,
      card_type: kind === 'card' ? cardType : null,
      expiry_month: kind === 'card' && expiryMonth ? Number(expiryMonth) : null,
      expiry_year: kind === 'card' && expiryYear ? Number(expiryYear) : null,
      memo: memo.trim() || null,
    });
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className={framed ? 'rounded-2xl border border-border bg-surface p-5 md:p-6' : undefined}
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          선택된 {kind === 'bank' ? '은행' : '카드사'}:{' '}
          <span className="font-semibold text-text">{institution?.name ?? institutionKey}</span>
        </p>
        <button type="button" onClick={onChangeInstitution} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white">
          변경하기
        </button>
      </div>

      <h3 className="text-base font-extrabold text-text">필수정보</h3>
      <div className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border">
        <FormRow label={kind === 'bank' ? '계좌 이름' : '카드 이름'} required>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-lg bg-background px-3 py-2 text-sm"
          />
        </FormRow>
        <FormRow label={kind === 'bank' ? '계좌 번호' : '카드 번호'} required>
          {kind === 'card' ? (
            <div className="grid grid-cols-4 gap-2">
              {parts.map((part, index) => (
                <input
                  key={index}
                  value={part}
                  inputMode="numeric"
                  maxLength={4}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, '').slice(0, 4);
                    setParts((prev) => prev.map((item, i) => (i === index ? digits : item)));
                    if (digits.length === 4) {
                      const next = event.currentTarget.parentElement?.children[index + 1];
                      if (next instanceof HTMLInputElement) next.focus();
                    }
                  }}
                  className="rounded-lg bg-background px-2 py-2 text-center text-sm"
                />
              ))}
            </div>
          ) : (
            <input
              value={number}
              inputMode="numeric"
              placeholder={editing ? editing.number_last4 : '숫자만 입력'}
              onChange={(event) => setNumber(event.target.value.replace(/[^\d- ]/g, ''))}
              className="w-full rounded-lg bg-background px-3 py-2 text-sm"
            />
          )}
        </FormRow>
      </div>

      <h3 className="mt-6 text-base font-extrabold text-text">선택정보</h3>
      <div className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border">
        <FormRow label="사용상태">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as PaymentInstrumentStatus)}
            className="rounded-lg bg-background px-2 py-1.5 text-sm"
          >
            {PAYMENT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className={`ml-2 rounded-md px-2 py-0.5 text-[11px] font-bold ${STATUS_CHIP[status]}`}>
            {PAYMENT_STATUS_LABEL[status]}
          </span>
        </FormRow>
        <FormRow label="구분">
          <select
            value={classification}
            onChange={(event) => onClassification(event.target.value as PaymentClassification)}
            className="rounded-lg bg-background px-2 py-1.5 text-sm"
          >
            {PAYMENT_CLASSIFICATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className={`ml-2 rounded-md px-2 py-0.5 text-[11px] font-bold ${CLASS_CHIP[classification]}`}>
            {PAYMENT_CLASSIFICATION_LABEL[classification]}
          </span>
        </FormRow>
        {kind === 'card' ? (
          <>
            <FormRow label="종류">
              <select
                value={cardType}
                onChange={(event) => setCardType(event.target.value as PaymentCardType)}
                className="rounded-lg bg-background px-2 py-1.5 text-sm"
              >
                {PAYMENT_CARD_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className={`ml-2 rounded-md px-2 py-0.5 text-[11px] font-bold ${TYPE_CHIP[cardType]}`}>
                {PAYMENT_CARD_TYPE_LABEL[cardType]}
              </span>
            </FormRow>
            <FormRow label="유효기간">
              <div className="flex items-center gap-2">
                <select
                  value={expiryYear}
                  onChange={(event) => setExpiryYear(event.target.value)}
                  className="rounded-lg bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">년</option>
                  {years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
                <span className="text-muted">/</span>
                <select
                  value={expiryMonth}
                  onChange={(event) => setExpiryMonth(event.target.value)}
                  className="rounded-lg bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">월</option>
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                    <option key={month} value={month}>
                      {String(month).padStart(2, '0')}
                    </option>
                  ))}
                </select>
              </div>
            </FormRow>
          </>
        ) : null}
        <FormRow label="비고">
          <input
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            className="w-full rounded-lg bg-background px-3 py-2 text-sm"
          />
        </FormRow>
      </div>

      {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

      <div className="mt-6 flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-xl px-3 py-2 text-sm font-semibold text-muted">
            취소
          </button>
          {onDelete ? (
            <button type="button" onClick={() => void onDelete()} className="rounded-xl px-3 py-2 text-sm font-semibold text-danger">
              삭제
            </button>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={saving}
          className="w-40 rounded-xl bg-primary py-3 text-sm font-extrabold text-white disabled:opacity-60"
        >
          {saving ? '저장 중…' : editing ? '저장하기' : '추가하기'}
        </button>
      </div>
    </form>
  );
}

function FormRow({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <p className="w-24 shrink-0 text-sm font-bold text-text">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </p>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
