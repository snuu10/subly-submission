/** 입력된 계좌·카드 번호에서 숫자만 남기고 뒤 4자를 취한다. */
export function last4FromNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

export function formatLast4(last4: string): string {
  return `•••• ${last4}`;
}
