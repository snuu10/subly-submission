import { useMemo, useState } from 'react';

import {
  CLASS_CHIP,
  InstitutionPicker,
  InstrumentForm,
  STATUS_CHIP,
  TYPE_CHIP,
} from '@/components/PaymentInstrumentEditor';
import { findInstitution } from '@/lib/financial-institutions';
import { formatLast4 } from '@/lib/payment-instrument';
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

type StatusFilter = 'all' | PaymentInstrumentStatus;
type ClassFilter = 'all' | PaymentClassification;
type TypeFilter = 'all' | PaymentCardType;
type Step = 'list' | 'picker' | 'form';

type PaymentMethodsWidgetProps = {
  kind: PaymentInstrumentKind;
  instruments: PaymentInstrument[];
  saving?: boolean;
  onSave: (input: PaymentInstrumentWrite, id?: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
};

export function PaymentMethodsWidget({
  kind,
  instruments,
  saving = false,
  onSave,
  onDelete,
}: PaymentMethodsWidgetProps) {
  const [step, setStep] = useState<Step>('list');
  const [editing, setEditing] = useState<PaymentInstrument | null>(null);
  const [institutionKey, setInstitutionKey] = useState<string | null>(null);
  const [formKind, setFormKind] = useState<PaymentInstrumentKind>(kind);
  const [classification, setClassification] = useState<PaymentClassification>('personal');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [classFilter, setClassFilter] = useState<ClassFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [query, setQuery] = useState('');

  const title = kind === 'bank' ? '은행 계좌' : '카드 계좌';
  const crumb = kind === 'bank' ? '은행' : '카드';

  const list = useMemo(() => {
    return instruments.filter((item) => {
      if (item.kind !== kind) return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (classFilter !== 'all' && item.classification !== classFilter) return false;
      if (kind === 'card' && typeFilter !== 'all' && item.card_type !== typeFilter) return false;
      if (query.trim()) {
        const institution = findInstitution(item.kind, item.institution_key);
        const hay = `${item.name} ${institution?.name ?? ''} ${item.number_last4}`.toLowerCase();
        if (!hay.includes(query.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [classFilter, instruments, kind, query, statusFilter, typeFilter]);

  function openAdd() {
    setEditing(null);
    setInstitutionKey(null);
    setFormKind(kind);
    setClassification('personal');
    setStep('picker');
  }

  function openEdit(item: PaymentInstrument) {
    setEditing(item);
    setInstitutionKey(item.institution_key);
    setFormKind(item.kind);
    setClassification(item.classification);
    setStep('form');
  }

  if (step === 'picker') {
    return (
      <InstitutionPicker
        classification={classification}
        onClassification={setClassification}
        onBack={() => setStep('list')}
        onSelect={(nextKind, key) => {
          setFormKind(nextKind);
          setInstitutionKey(key);
          setStep('form');
        }}
      />
    );
  }

  if (step === 'form' && institutionKey) {
    return (
      <InstrumentForm
        kind={formKind}
        institutionKey={institutionKey}
        classification={classification}
        editing={editing}
        saving={saving}
        onClassification={setClassification}
        onChangeInstitution={() => setStep('picker')}
        onCancel={() => {
          setStep('list');
          setEditing(null);
        }}
        onSave={async (input) => {
          await onSave(input, editing?.id);
          setStep('list');
          setEditing(null);
        }}
        onDelete={
          editing
            ? async () => {
                if (!window.confirm('이 결제수단을 삭제할까요? 연결된 구독에서는 선택이 해제됩니다.')) return;
                await onDelete(editing.id);
                setStep('list');
                setEditing(null);
              }
            : undefined
        }
      />
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-5 md:p-6">
      <p className="text-xs font-semibold text-muted">
        자산 <span className="text-border">›</span> 결제수단 <span className="text-border">›</span>{' '}
        <span className="text-primary">{crumb}</span>
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-extrabold text-text">{title}</h2>
        <button
          type="button"
          onClick={openAdd}
          className="rounded-lg bg-primary px-3 py-2 text-sm font-bold text-white"
        >
          + 자산 추가
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <FilterChips
            value={statusFilter}
            options={[{ value: 'all', label: '전체' }, ...PAYMENT_STATUS_OPTIONS]}
            onChange={setStatusFilter}
          />
        </div>
        <label className="relative min-w-[220px] flex-1 md:max-w-xs">
          <span className="pointer-events-none absolute left-3 top-2.5 text-muted">⌕</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="검색어를 입력해주세요"
            className="w-full rounded-xl border border-border bg-background py-2 pl-8 pr-3 text-sm"
          />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <FilterChips
          value={classFilter}
          options={[{ value: 'all', label: '전체 구분' }, ...PAYMENT_CLASSIFICATION_OPTIONS]}
          onChange={setClassFilter}
        />
        {kind === 'card' ? (
          <FilterChips
            value={typeFilter}
            options={[{ value: 'all', label: '전체 종류' }, ...PAYMENT_CARD_TYPE_OPTIONS]}
            onChange={setTypeFilter}
          />
        ) : null}
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-muted">
          <p className="text-4xl">📭</p>
          <p className="text-sm">조회된 결제수단이 없어요.</p>
          <button
            type="button"
            onClick={openAdd}
            className="rounded-lg bg-primary px-3 py-2 text-sm font-bold text-white"
          >
            + 자산 추가
          </button>
        </div>
      ) : (
        <ul className="mt-5 grid gap-3 md:grid-cols-2">
          {list.map((item) => {
            const institution = findInstitution(item.kind, item.institution_key);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openEdit(item)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-border bg-background px-4 py-3 text-left hover:border-primary"
                >
                  {institution?.icon ? (
                    <img src={institution.icon} alt="" className="size-10 object-contain" />
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-text">{item.name}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {institution?.name ?? item.institution_key} · {formatLast4(item.number_last4)}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${STATUS_CHIP[item.status]}`}>
                        {PAYMENT_STATUS_LABEL[item.status]}
                      </span>
                      <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${CLASS_CHIP[item.classification]}`}>
                        {PAYMENT_CLASSIFICATION_LABEL[item.classification]}
                      </span>
                      {item.card_type ? (
                        <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${TYPE_CHIP[item.card_type]}`}>
                          {PAYMENT_CARD_TYPE_LABEL[item.card_type]}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function FilterChips<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
              selected ? 'border-primary bg-accent text-primary' : 'border-border bg-background text-muted'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </>
  );
}
