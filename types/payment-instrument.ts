export type PaymentInstrumentKind = 'bank' | 'card';

export type PaymentInstrumentStatus = 'undecided' | 'unused' | 'in_use' | 'expired';

export type PaymentClassification = 'personal' | 'corporate';

export type PaymentCardType = 'credit' | 'check';

export type PaymentInstrument = {
  id: string;
  user_id: string;
  kind: PaymentInstrumentKind;
  institution_key: string;
  name: string;
  number_last4: string;
  status: PaymentInstrumentStatus;
  classification: PaymentClassification;
  card_type: PaymentCardType | null;
  expiry_month: number | null;
  expiry_year: number | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
};

export type PaymentInstrumentWrite = {
  kind: PaymentInstrumentKind;
  institution_key: string;
  name: string;
  number_last4: string;
  status: PaymentInstrumentStatus;
  classification: PaymentClassification;
  card_type?: PaymentCardType | null;
  expiry_month?: number | null;
  expiry_year?: number | null;
  memo?: string | null;
};

export const PAYMENT_STATUS_LABEL: Record<PaymentInstrumentStatus, string> = {
  undecided: '미정',
  unused: '미사용',
  in_use: '사용중',
  expired: '만료',
};

export const PAYMENT_CLASSIFICATION_LABEL: Record<PaymentClassification, string> = {
  personal: '개인',
  corporate: '법인',
};

export const PAYMENT_CARD_TYPE_LABEL: Record<PaymentCardType, string> = {
  credit: '신용카드',
  check: '체크카드',
};

export const PAYMENT_STATUS_OPTIONS = [
  { value: 'undecided', label: PAYMENT_STATUS_LABEL.undecided },
  { value: 'unused', label: PAYMENT_STATUS_LABEL.unused },
  { value: 'in_use', label: PAYMENT_STATUS_LABEL.in_use },
  { value: 'expired', label: PAYMENT_STATUS_LABEL.expired },
] as const;

export const PAYMENT_CLASSIFICATION_OPTIONS = [
  { value: 'personal', label: PAYMENT_CLASSIFICATION_LABEL.personal },
  { value: 'corporate', label: PAYMENT_CLASSIFICATION_LABEL.corporate },
] as const;

export const PAYMENT_CARD_TYPE_OPTIONS = [
  { value: 'credit', label: PAYMENT_CARD_TYPE_LABEL.credit },
  { value: 'check', label: PAYMENT_CARD_TYPE_LABEL.check },
] as const;
