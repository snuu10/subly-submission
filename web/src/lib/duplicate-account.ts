import { matchPresetByName } from '@/lib/presets';
import type { Subscription } from '@/types';

/** 계정 중복은 같은 서비스 안에서만 본다. 넷플릭스 A + 왓챠 A는 허용한다. */

export function normalizeAccount(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

function nameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function sameService(
  item: Pick<Subscription, 'name' | 'preset_id'>,
  name: string,
  presetId?: string | null,
): boolean {
  const preset = presetId || matchPresetByName(name)?.id || null;
  const itemPreset = item.preset_id || matchPresetByName(item.name)?.id || null;
  // 넷플릭스와 왓챠처럼 서비스가 다르면 같은 이메일이어도 된다.
  if (preset && itemPreset) return preset === itemPreset;
  const needle = nameKey(name);
  const other = nameKey(item.name);
  return needle.length >= 2 && other.length >= 2 && (other.includes(needle) || needle.includes(other));
}

export function sameServiceSubscriptions(
  all: Subscription[],
  name: string,
  presetId?: string | null,
  excludeId?: string | null,
): Subscription[] {
  return all.filter((item) => {
    if (!item.is_active) return false;
    if (excludeId && item.id === excludeId) return false;
    return sameService(item, name, presetId);
  });
}

export function duplicateAccountIssue(
  all: Subscription[],
  input: { id?: string | null; name: string; account_id?: string | null; preset_id?: string | null },
): 'required' | 'taken' | null {
  const siblings = sameServiceSubscriptions(all, input.name, input.preset_id, input.id ?? null);
  if (siblings.length === 0) return null;
  const account = normalizeAccount(input.account_id);
  if (!account) return 'required';
  const key = account.toLowerCase();
  if (siblings.some((item) => normalizeAccount(item.account_id)?.toLowerCase() === key)) {
    return 'taken';
  }
  return null;
}

/** 체험 구독은 이름 중복 여부와 무관하게 계정·결제수단을 둘 다 받는다 — 어느 카드가
 * 빠질지, 어떤 계정의 체험인지 나중에(종료 알림·해지 안내) 구분해야 하기 때문. */
export function trialRequirementIssue(input: {
  is_trial?: boolean;
  account_id?: string | null;
  payment_instrument_id?: string | null;
}): 'account_required' | 'payment_required' | null {
  if (!input.is_trial) return null;
  if (!normalizeAccount(input.account_id)) return 'account_required';
  if (!input.payment_instrument_id) return 'payment_required';
  return null;
}

export function trialRequirementMessage(issue: 'account_required' | 'payment_required'): string {
  return issue === 'account_required'
    ? '무료 체험은 가입 계정(이메일 또는 아이디)을 꼭 입력해 주세요.'
    : '무료 체험은 결제수단을 꼭 선택해 주세요. 어느 카드에서 결제될지 확인이 필요해요.';
}

export function duplicateAccountMessage(issue: 'required' | 'taken'): string {
  if (issue === 'required') {
    return '같은 서비스가 이미 있어요. 구분할 가입 계정(이메일 또는 아이디)을 입력해 주세요.';
  }
  return '같은 서비스에는 같은 계정을 넣을 수 없어요. 다른 계정을 입력해 주세요. 다른 서비스는 같은 이메일이어도 괜찮아요.';
}

export function mapSubscriptionWriteError(message: string): string {
  if (message.includes('구분할 가입 계정')) return duplicateAccountMessage('required');
  if (
    message.includes('같은 서비스에는 같은 계정') ||
    message.includes('같은 계정으로 등록') ||
    message.includes('subscriptions_user_name_account_active_uidx')
  ) {
    return duplicateAccountMessage('taken');
  }
  return message;
}
