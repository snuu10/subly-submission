import type { PaymentInstrumentKind } from '@/types/payment-instrument';

export type FinancialInstitution = {
  key: string;
  name: string;
  kind: PaymentInstrumentKind;
  icon: string;
};

const bankIcons = import.meta.glob('../../../assets/images/financial-institutions/banks/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const cardIcons = import.meta.glob('../../../assets/images/financial-institutions/cards/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

function iconFor(map: Record<string, string>, key: string): string {
  const hit = Object.entries(map).find(([path]) => path.endsWith(`/${key}.png`));
  return hit?.[1] ?? '';
}

const BANKS: { key: string; name: string }[] = [
  { key: 'nh', name: '농협은행' },
  { key: 'ibk', name: '기업은행' },
  { key: 'su', name: 'KDB산업은행' },
  { key: 'kb', name: '국민은행' },
  { key: 'shp', name: '수협은행' },
  { key: 'hn', name: '하나은행' },
  { key: 'shn', name: '신한은행' },
  { key: 'sc', name: 'SC제일은행' },
  { key: 'wr', name: '우리은행' },
  { key: 'citi', name: '씨티은행' },
  { key: 'im', name: 'iM뱅크' },
  { key: 'kbank', name: '케이뱅크' },
  { key: 'jb', name: '전북은행' },
  { key: 'bnk', name: '경남은행' },
  { key: 'sm', name: '새마을금고' },
  { key: 'shb', name: '신협은행' },
  { key: 'uc', name: '우체국' },
  { key: 'toss', name: '토스뱅크' },
  { key: 'bs', name: '부산은행' },
  { key: 'kko', name: '카카오뱅크' },
  { key: 'sbi', name: 'SBI저축은행' },
  { key: 'kj', name: '광주은행' },
  { key: 'jj', name: '제주은행' },
];

const CARDS: { key: string; name: string }[] = [
  { key: 'citi', name: '씨티카드' },
  { key: 'shinhan', name: '신한카드' },
  { key: 'lotte', name: '롯데카드' },
  { key: 'kbcard', name: 'KB국민카드' },
  { key: 'bc', name: 'BC카드' },
  { key: 'keb', name: '하나카드' },
  { key: 'samsungcard', name: '삼성카드' },
  { key: 'woori', name: '우리카드' },
  { key: 'hyundaicard', name: '현대카드' },
  { key: 'nh', name: 'NH카드' },
];

export const BANK_INSTITUTIONS: FinancialInstitution[] = BANKS.map((item) => ({
  ...item,
  kind: 'bank',
  icon: iconFor(bankIcons, item.key),
}));

export const CARD_INSTITUTIONS: FinancialInstitution[] = CARDS.map((item) => ({
  ...item,
  kind: 'card',
  icon: iconFor(cardIcons, item.key),
}));

export function institutionsFor(kind: PaymentInstrumentKind): FinancialInstitution[] {
  return kind === 'bank' ? BANK_INSTITUTIONS : CARD_INSTITUTIONS;
}

export function findInstitution(
  kind: PaymentInstrumentKind,
  key: string
): FinancialInstitution | undefined {
  return institutionsFor(kind).find((item) => item.key === key);
}
