import type { ImageSourcePropType } from 'react-native';

import type { PaymentInstrumentKind } from '@/types/payment-instrument';

export type FinancialInstitution = {
  key: string;
  name: string;
  kind: PaymentInstrumentKind;
  icon: ImageSourcePropType;
};

export const BANK_INSTITUTIONS: FinancialInstitution[] = [
  { key: 'nh', name: '농협은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/nh.png') },
  { key: 'ibk', name: '기업은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/ibk.png') },
  { key: 'su', name: 'KDB산업은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/su.png') },
  { key: 'kb', name: '국민은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/kb.png') },
  { key: 'shp', name: '수협은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/shp.png') },
  { key: 'hn', name: '하나은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/hn.png') },
  { key: 'shn', name: '신한은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/shn.png') },
  { key: 'sc', name: 'SC제일은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/sc.png') },
  { key: 'wr', name: '우리은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/wr.png') },
  { key: 'citi', name: '씨티은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/citi.png') },
  { key: 'im', name: 'iM뱅크', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/im.png') },
  { key: 'kbank', name: '케이뱅크', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/kbank.png') },
  { key: 'jb', name: '전북은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/jb.png') },
  { key: 'bnk', name: '경남은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/bnk.png') },
  { key: 'sm', name: '새마을금고', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/sm.png') },
  { key: 'shb', name: '신협은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/shb.png') },
  { key: 'uc', name: '우체국', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/uc.png') },
  { key: 'toss', name: '토스뱅크', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/toss.png') },
  { key: 'bs', name: '부산은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/bs.png') },
  { key: 'kko', name: '카카오뱅크', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/kko.png') },
  { key: 'sbi', name: 'SBI저축은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/sbi.png') },
  { key: 'kj', name: '광주은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/kj.png') },
  { key: 'jj', name: '제주은행', kind: 'bank', icon: require('../assets/images/financial-institutions/banks/jj.png') },
];

export const CARD_INSTITUTIONS: FinancialInstitution[] = [
  { key: 'citi', name: '씨티카드', kind: 'card', icon: require('../assets/images/financial-institutions/cards/citi.png') },
  { key: 'shinhan', name: '신한카드', kind: 'card', icon: require('../assets/images/financial-institutions/cards/shinhan.png') },
  { key: 'lotte', name: '롯데카드', kind: 'card', icon: require('../assets/images/financial-institutions/cards/lotte.png') },
  { key: 'kbcard', name: 'KB국민카드', kind: 'card', icon: require('../assets/images/financial-institutions/cards/kbcard.png') },
  { key: 'bc', name: 'BC카드', kind: 'card', icon: require('../assets/images/financial-institutions/cards/bc.png') },
  { key: 'keb', name: '하나카드', kind: 'card', icon: require('../assets/images/financial-institutions/cards/keb.png') },
  { key: 'samsungcard', name: '삼성카드', kind: 'card', icon: require('../assets/images/financial-institutions/cards/samsungcard.png') },
  { key: 'woori', name: '우리카드', kind: 'card', icon: require('../assets/images/financial-institutions/cards/woori.png') },
  { key: 'hyundaicard', name: '현대카드', kind: 'card', icon: require('../assets/images/financial-institutions/cards/hyundaicard.png') },
  { key: 'nh', name: 'NH카드', kind: 'card', icon: require('../assets/images/financial-institutions/cards/nh.png') },
];

export function institutionsFor(kind: PaymentInstrumentKind): FinancialInstitution[] {
  return kind === 'bank' ? BANK_INSTITUTIONS : CARD_INSTITUTIONS;
}

export function findInstitution(
  kind: PaymentInstrumentKind,
  key: string
): FinancialInstitution | undefined {
  return institutionsFor(kind).find((item) => item.key === key);
}
