import { CLASS_CHIP, STATUS_CHIP, TYPE_CHIP } from '@/components/PaymentInstrumentEditor';
import { WidgetCard } from '@/components/WidgetCard';
import { findInstitution } from '@/lib/financial-institutions';
import { formatLast4 } from '@/lib/payment-instrument';
import type { PaymentInstrument } from '@/types/payment-instrument';
import {
  PAYMENT_CARD_TYPE_LABEL,
  PAYMENT_CLASSIFICATION_LABEL,
  PAYMENT_STATUS_LABEL,
} from '@/types/payment-instrument';

type PaymentInstrumentListWidgetProps = {
  instruments: PaymentInstrument[];
  onAdd: () => void;
  onSelect: (item: PaymentInstrument) => void;
};

export function PaymentInstrumentListWidget({
  instruments,
  onAdd,
  onSelect,
}: PaymentInstrumentListWidgetProps) {
  return (
    <WidgetCard title="결제수단 목록" hint={`${instruments.length}개`}>
      {instruments.length === 0 ? (
        <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-muted">등록된 결제수단이 없어요.</p>
          <button
            type="button"
            onClick={onAdd}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-bold text-white"
          >
            <PlusIcon />
            결제수단 등록
          </button>
        </div>
      ) : (
        <ul className="flex max-h-[320px] flex-col gap-2 overflow-y-auto pr-1">
          {instruments.map((item) => {
            const institution = findInstitution(item.kind, item.institution_key);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="flex w-full items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left hover:bg-background"
                >
                  {institution?.icon ? (
                    <img src={institution.icon} alt="" className="size-8 object-contain" />
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text">{item.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {institution?.name ?? item.institution_key} · {formatLast4(item.number_last4)}
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${STATUS_CHIP[item.status]}`}>
                        {PAYMENT_STATUS_LABEL[item.status]}
                      </span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${CLASS_CHIP[item.classification]}`}
                      >
                        {PAYMENT_CLASSIFICATION_LABEL[item.classification]}
                      </span>
                      {item.card_type ? (
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${TYPE_CHIP[item.card_type]}`}>
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
    </WidgetCard>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
