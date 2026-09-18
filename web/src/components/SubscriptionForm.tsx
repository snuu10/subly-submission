import { useEffect, useRef, useState } from 'react';

import { ServiceIcon } from '@/components/ServiceIcon';
import { suggestCategory } from '@/lib/ai-briefings';
import { defaultAnchorDate } from '@/lib/calc';
import { findByKey } from '@/lib/categories';
import type { SubscriptionWriteInput } from '@/lib/data';
import {
  duplicateAccountIssue,
  duplicateAccountMessage,
  sameServiceSubscriptions,
  trialRequirementIssue,
  trialRequirementMessage,
} from '@/lib/duplicate-account';
import { findInstitution } from '@/lib/financial-institutions';
import { formatLast4 } from '@/lib/payment-instrument';
import { encodeServiceIcon, isServiceIconKey, SERVICE_ICON_OPTIONS } from '@/lib/service-icons';
import type { BillingCycle, Category, Subscription, SystemCategoryKey } from '@/types';
import type { PaymentInstrument } from '@/types/payment-instrument';

const CYCLES: { value: BillingCycle; label: string }[] = [
  { value: 'monthly', label: '월간' },
  { value: 'yearly', label: '연간' },
  { value: 'one_time', label: '일회성' },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type SubscriptionFormDraft = {
  name: string;
  amount: number;
  billing_cycle: BillingCycle;
  category_id: string;
  anchor_date: string;
  memo?: string;
  preset_id?: string | null;
  account_id?: string;
};

type SubscriptionFormProps = {
  categories: Category[];
  subscriptions: Subscription[];
  paymentInstruments?: PaymentInstrument[];
  editing: Subscription | null;
  draft?: SubscriptionFormDraft | null;
  fromOcr?: boolean;
  onClose: () => void;
  onSave: (input: SubscriptionWriteInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  onReceipt?: () => void;
};

function parseAmount(raw: string): number | null {
  const parsed = Number(raw.replace(/,/g, '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

export function SubscriptionForm({
  categories,
  subscriptions,
  paymentInstruments = [],
  editing,
  draft,
  fromOcr = false,
  onClose,
  onSave,
  onDelete,
  onReceipt,
}: SubscriptionFormProps) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [anchorDate, setAnchorDate] = useState(defaultAnchorDate());
  const [isActive, setIsActive] = useState(true);
  const [memo, setMemo] = useState('');
  const [emoji, setEmoji] = useState('');
  const [accountId, setAccountId] = useState('');
  const [paymentInstrumentId, setPaymentInstrumentId] = useState('');
  const [isTrial, setIsTrial] = useState(false);
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const categoryLocked = useRef(false);

  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setAmount(String(editing.amount));
      setCycle(editing.billing_cycle);
      setCategoryId(editing.category_id);
      setAnchorDate(editing.anchor_date);
      setIsActive(editing.is_active);
      setMemo(editing.memo ?? '');
      setEmoji(editing.emoji ?? '');
      setAccountId(editing.account_id ?? '');
      setPaymentInstrumentId(editing.payment_instrument_id ?? '');
      setIsTrial(editing.is_trial ?? false);
      categoryLocked.current = true;
    } else if (draft) {
      setName(draft.name);
      setAmount(String(draft.amount));
      setCycle(draft.billing_cycle);
      setCategoryId(draft.category_id);
      setAnchorDate(draft.anchor_date);
      setIsActive(true);
      setMemo(draft.memo ?? '');
      setEmoji('');
      setAccountId(draft.account_id ?? '');
      setPaymentInstrumentId('');
      setIsTrial(false);
      categoryLocked.current = Boolean(draft.category_id);
    } else {
      setName('');
      setAmount('');
      setCycle('monthly');
      setCategoryId(categories[0]?.id ?? '');
      setAnchorDate(defaultAnchorDate());
      setIsActive(true);
      setMemo('');
      setEmoji('');
      setAccountId('');
      setPaymentInstrumentId('');
      setIsTrial(false);
      categoryLocked.current = false;
    }
    setError(null);
  }, [editing, draft, categories]);

  useEffect(() => {
    if (editing || categoryLocked.current) return;
    const trimmed = name.trim();
    if (trimmed.length < 2) return;

    const handle = setTimeout(() => {
      void suggestCategory(trimmed).then((result) => {
        if (!result || categoryLocked.current) return;
        const key = result.category_key as SystemCategoryKey;
        const mapped = findByKey(categories, key);
        setCategoryId((current) => mapped?.id ?? current);
        if (isServiceIconKey(result.icon_key)) setEmoji(encodeServiceIcon(result.icon_key));
      });
    }, 400);

    return () => clearTimeout(handle);
  }, [categories, editing, name]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsedAmount = parseAmount(amount);
    if (!name.trim()) {
      setError('이름을 입력하세요.');
      return;
    }
    if (parsedAmount == null) {
      setError('금액을 확인하세요.');
      return;
    }
    if (!categoryId) {
      setError('카테고리를 선택하세요.');
      return;
    }
    if (!ISO_DATE.test(anchorDate)) {
      setError('결제일을 YYYY-MM-DD 형식으로 입력하세요.');
      return;
    }
    if (isTrial && cycle === 'one_time') {
      setError('일회성 결제는 무료 체험으로 등록할 수 없어요.');
      return;
    }
    const presetId = editing?.preset_id ?? draft?.preset_id ?? null;
    const accountIssue = duplicateAccountIssue(subscriptions, {
      id: editing?.id,
      name: name.trim(),
      account_id: accountId,
      preset_id: presetId,
    });
    if (accountIssue) {
      setError(duplicateAccountMessage(accountIssue));
      return;
    }
    const trialIssue = trialRequirementIssue({
      is_trial: isTrial,
      account_id: accountId,
      payment_instrument_id: paymentInstrumentId || null,
    });
    if (trialIssue) {
      setError(trialRequirementMessage(trialIssue));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        amount: parsedAmount,
        billing_cycle: cycle,
        category_id: categoryId,
        anchor_date: anchorDate,
        is_active: isActive,
        memo: memo.trim() || null,
        emoji: emoji || null,
        preset_id: editing?.preset_id ?? draft?.preset_id ?? null,
        account_id: accountId.trim() || null,
        payment_instrument_id: paymentInstrumentId || null,
        is_trial: isTrial,
        trial_ends_at: isTrial ? anchorDate : null,
      });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    if (!window.confirm('이 구독을 삭제할까요?')) return;
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '삭제하지 못했습니다.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-extrabold text-text">{editing ? '구독 수정' : '구독 추가'}</h2>
          <button type="button" onClick={onClose} className="text-sm font-semibold text-muted hover:text-text">
            닫기
          </button>
        </div>
        {fromOcr && !editing ? (
          <p className="mb-4 rounded-xl bg-accent px-3 py-2 text-xs font-semibold leading-5 text-primary">
            AI가 영수증에서 추출한 정보예요. 내용을 확인하고 저장하면 앱에도 바로 반영됩니다.
          </p>
        ) : null}
        {!editing && !fromOcr && onReceipt ? (
          <button
            type="button"
            onClick={onReceipt}
            className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-dashed border-border bg-background px-3 py-3 text-left hover:border-primary hover:bg-accent"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
              <CameraIcon />
            </span>
            <span>
              <span className="block text-sm font-bold text-text">영수증으로 등록</span>
              <span className="mt-0.5 block text-xs font-medium text-muted">사진에서 이름·금액을 채워 줘요</span>
            </span>
          </button>
        ) : null}

        <label className="mb-3 block text-sm font-semibold text-text">
          이름
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm font-normal"
            placeholder="넷플릭스"
          />
        </label>

        <label className="mb-3 block text-sm font-semibold text-text">
          금액
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="numeric"
            className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm font-normal"
            placeholder="17000"
          />
        </label>

        <p className="mb-1 text-sm font-semibold text-text">결제 주기</p>
        <div className="mb-2 flex gap-2">
          {CYCLES.map((item) => {
            const disabled = isTrial && item.value === 'one_time';
            return (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  if (disabled) {
                    setError('무료 체험은 월간 또는 연간 구독만 등록할 수 있어요.');
                    return;
                  }
                  setCycle(item.value);
                }}
                className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${
                  cycle === item.value ? 'bg-primary text-white' : 'border border-border text-muted'
                } ${disabled ? 'opacity-40' : ''}`}
              >
                {item.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            setIsTrial((prev) => {
              const next = !prev;
              // 체험은 일회성 결제와 조합할 수 없다 — 켤 때만 월간으로 바꾸고, 끌 때는 그대로 둔다.
              if (next && cycle === 'one_time') setCycle('monthly');
              return next;
            });
          }}
          role="switch"
          aria-checked={isTrial}
          className="mb-3 inline-flex min-h-10 items-center gap-3 rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-text transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span>무료 체험</span>
          <span className={`text-[10px] font-bold ${isTrial ? 'text-primary' : 'text-muted'}`}>
            {isTrial ? 'ON' : 'OFF'}
          </span>
          <span
            aria-hidden="true"
            className={`relative h-5 w-9 rounded-full transition-colors ${
              isTrial ? 'bg-primary' : 'bg-border'
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                isTrial ? 'translate-x-[18px]' : 'translate-x-0.5'
              }`}
            />
          </span>
        </button>

        <label className="mb-3 block text-sm font-semibold text-text">
          카테고리
          <select
            value={categoryId}
            onChange={(event) => {
              categoryLocked.current = true;
              setCategoryId(event.target.value);
            }}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm font-normal"
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setIconPickerOpen((open) => !open)}
            aria-expanded={iconPickerOpen}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border bg-surface px-2.5 text-sm font-semibold text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <ServiceIcon
              presetId={editing?.preset_id ?? draft?.preset_id ?? null}
              name={name}
              color={categories.find((item) => item.id === categoryId)?.color}
              emoji={emoji}
              categoryKey={categories.find((item) => item.id === categoryId)?.key}
              size={28}
            />
            <span>{emoji && !editing ? 'AI 추천 아이콘' : '아이콘 선택'}</span>
          </button>
          {iconPickerOpen ? (
            <div className="mt-2 grid grid-cols-8 gap-2 rounded-xl border border-border bg-surface p-2">
              {SERVICE_ICON_OPTIONS.map((option) => {
                const encoded = encodeServiceIcon(option.key);
                const selected = emoji === encoded;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => {
                      setEmoji(encoded);
                      setIconPickerOpen(false);
                    }}
                    aria-label={`${option.label} 아이콘`}
                    aria-pressed={selected}
                    className={`flex aspect-square items-center justify-center rounded-xl border transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                      selected ? 'border-primary bg-accent' : 'border-border bg-surface'
                    }`}
                  >
                    <ServiceIcon
                      name={option.label}
                      color={categories.find((item) => item.id === categoryId)?.color}
                      emoji={encoded}
                      size={32}
                    />
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <label className="mb-3 block text-sm font-semibold text-text">
          {isTrial ? '첫 유료 결제일' : '결제일'}
          <input
            type="date"
            value={anchorDate}
            onChange={(event) => setAnchorDate(event.target.value)}
            className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm font-normal"
          />
        </label>

        <label className="mb-3 block text-sm font-semibold text-text">
          {sameServiceSubscriptions(subscriptions, name, editing?.preset_id ?? draft?.preset_id, editing?.id)
            .length > 0 || isTrial
            ? '가입 계정 (필수)'
            : '가입 계정 (선택)'}
          <input
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm font-normal"
            placeholder="이메일 또는 아이디. 다른 서비스와는 같아도 됩니다"
          />
        </label>

        <label className="mb-3 block text-sm font-semibold text-text">
          {isTrial ? '결제수단 (필수)' : '결제수단 (선택)'}
          <select
            value={paymentInstrumentId}
            onChange={(event) => setPaymentInstrumentId(event.target.value)}
            className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm font-normal"
          >
            <option value="">없음</option>
            {paymentInstruments.map((item) => {
              const institution = findInstitution(item.kind, item.institution_key);
              return (
                <option key={item.id} value={item.id}>
                  {item.name} · {institution?.name ?? item.institution_key} {formatLast4(item.number_last4)}
                </option>
              );
            })}
          </select>
          {paymentInstruments.length === 0 ? (
            <span className="mt-1 block text-xs font-semibold text-primary">
              결제수단이 없어요 — 대시보드의 결제수단 위젯에서 먼저 등록해 주세요.
            </span>
          ) : null}
        </label>

        <label className="mb-4 flex items-center gap-2 text-sm font-semibold text-text">
          <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
          활성 상태
        </label>

        <label className="mb-4 block text-sm font-semibold text-text">
          메모
          <input
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            className="mt-1 w-full rounded-xl border border-border px-3 py-2 text-sm font-normal"
            placeholder="선택"
          />
        </label>

        {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
        {categories.length === 0 ? (
          <p className="mb-3 text-sm text-danger">카테고리를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.</p>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          {editing && onDelete ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting || saving}
              className="rounded-xl px-3 py-2 text-sm font-semibold text-danger hover:bg-rose-bg"
            >
              {deleting ? '삭제 중…' : '삭제'}
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={saving || deleting || categories.length === 0}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
          >
            {saving ? '저장 중…' : editing ? '수정 저장' : '추가'}
          </button>
        </div>
      </form>
    </div>
  );
}

function CameraIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
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
