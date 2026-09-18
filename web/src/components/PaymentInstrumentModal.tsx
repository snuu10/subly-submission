import { useState } from 'react';

import { InstitutionPicker, InstrumentForm } from '@/components/PaymentInstrumentEditor';
import type {
  PaymentClassification,
  PaymentInstrument,
  PaymentInstrumentKind,
  PaymentInstrumentWrite,
} from '@/types/payment-instrument';

type PaymentInstrumentModalProps = {
  editing: PaymentInstrument | null;
  saving?: boolean;
  onClose: () => void;
  onSave: (input: PaymentInstrumentWrite, id?: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
};

export function PaymentInstrumentModal({
  editing,
  saving = false,
  onClose,
  onSave,
  onDelete,
}: PaymentInstrumentModalProps) {
  const [step, setStep] = useState<'picker' | 'form'>(editing ? 'form' : 'picker');
  const [institutionKey, setInstitutionKey] = useState<string | null>(editing?.institution_key ?? null);
  const [kind, setKind] = useState<PaymentInstrumentKind>(editing?.kind ?? 'bank');
  const [classification, setClassification] = useState<PaymentClassification>(
    editing?.classification ?? 'personal'
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-16"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-border bg-surface p-5 shadow-xl md:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        {step === 'picker' || !institutionKey ? (
          <InstitutionPicker
            framed={false}
            classification={classification}
            onClassification={setClassification}
            onBack={onClose}
            onSelect={(nextKind, key) => {
              setKind(nextKind);
              setInstitutionKey(key);
              setStep('form');
            }}
          />
        ) : (
          <InstrumentForm
            key={`${editing?.id ?? 'new'}-${kind}-${institutionKey}`}
            framed={false}
            kind={kind}
            institutionKey={institutionKey}
            classification={classification}
            editing={editing}
            saving={saving}
            onClassification={setClassification}
            onChangeInstitution={() => setStep('picker')}
            onCancel={onClose}
            onSave={async (input) => {
              await onSave(input, editing?.id);
              onClose();
            }}
            onDelete={
              editing && onDelete
                ? async () => {
                    if (!window.confirm('이 결제수단을 삭제할까요? 연결된 구독에서는 선택이 해제됩니다.')) {
                      return;
                    }
                    await onDelete(editing.id);
                    onClose();
                  }
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}
