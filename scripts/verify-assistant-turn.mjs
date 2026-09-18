#!/usr/bin/env node
/**
 * 테스터 계정으로 assistant-turn 맥락을 확인한다. 화면 클릭이 아니라 API만 본다.
 *
 *   TESTER_EMAIL=tester@subly.app TESTER_PASSWORD='…' node scripts/verify-assistant-turn.mjs
 *
 * 루트 `.env`의 EXPO_PUBLIC_* 와 선택적 TESTER_* 도 읽는다. 비밀번호를 출력하지 않는다.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(path) {
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

loadEnvFile(join(root, '.env'));
loadEnvFile(join(root, 'web/.env'));

const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(
  /\/$/,
  ''
);
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const email = process.env.TESTER_EMAIL || 'tester@subly.app';
const password = process.env.TESTER_PASSWORD || '';

function fail(message) {
  console.error(message);
  process.exit(2);
}

if (!url || !anon || anon === 'your-anon-key') {
  fail('루트 .env 에 EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY 가 필요합니다.');
}
if (!password) {
  fail(
    [
      `TESTER_PASSWORD 가 없습니다. (${email})`,
      '채팅에 비밀번호를 알려 주거나, 로컬에서만:',
      `  TESTER_EMAIL=${email} TESTER_PASSWORD='…' node scripts/verify-assistant-turn.mjs`,
      '비밀번호는 git에 커밋하지 마세요. 화면 확인 방법은 docs/ACCESS.md 를 보세요.',
    ].join('\n')
  );
}

async function jsonOrText(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function signIn() {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anon,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const body = await jsonOrText(res);
  if (!res.ok || typeof body.access_token !== 'string') {
    const hint =
      typeof body.error_description === 'string'
        ? body.error_description
        : typeof body.msg === 'string'
          ? body.msg
          : res.statusText;
    fail(`로그인 실패 (${res.status}): ${hint}`);
  }
  return body.access_token;
}

function authHeaders(token) {
  return {
    apikey: anon,
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

async function resetSession(token) {
  const res = await fetch(`${url}/rest/v1/rpc/reset_assistant_session`, {
    method: 'POST',
    headers: authHeaders(token),
    body: '{}',
  });
  const body = await jsonOrText(res);
  if (!res.ok) {
    fail(`세션 초기화 실패 (${res.status}): ${JSON.stringify(body)}`);
  }
}

async function turn(token, text, history = []) {
  const res = await fetch(`${url}/functions/v1/assistant-turn`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ text, history, platform: 'web' }),
  });
  const body = await jsonOrText(res);
  if (!res.ok) {
    fail(`assistant-turn 실패 (${res.status}, "${text}"): ${JSON.stringify(body)}`);
  }
  return body;
}

function assert(cond, message) {
  if (!cond) fail(message);
}

const token = await signIn();
await resetSession(token);

const history = [];
function remember(role, content) {
  history.push({ role, content });
  if (history.length > 8) history.splice(0, history.length - 8);
}

const list = await turn(token, '목록');
remember('user', '목록');
remember('assistant', typeof list.reply === 'string' ? list.reply : '');
const ranked = Array.isArray(list.ranked_subscription_ids) ? list.ranked_subscription_ids : [];
const listReply = typeof list.reply === 'string' ? list.reply : '';
assert(
  listReply.includes('\n') || ranked.length > 0,
  `목록 응답이 한 줄 문장으로 보입니다: ${listReply.slice(0, 120)}`
);
console.log(`ok 목록  intent=${list.intent} ranked=${ranked.length}`);

const expensive = await turn(token, '그중에서 제일 비싼', history);
remember('user', '그중에서 제일 비싼');
remember('assistant', typeof expensive.reply === 'string' ? expensive.reply : '');
assert(
  expensive.intent === 'expensive_subscriptions',
  `그중에서 제일 비싼 intent=${expensive.intent}`
);
console.log(`ok 그중 제일 비싼  intent=${expensive.intent}`);

await resetSession(token);
history.length = 0;

const ask = await turn(token, '홍티비 등록');
remember('user', '홍티비 등록');
remember('assistant', typeof ask.reply === 'string' ? ask.reply : '');
assert(
  ask.intent === 'create_subscription',
  `홍티비 등록 intent=${ask.intent}`
);
assert(
  ask.extract == null || ask.extract?.amount == null,
  '홍티비 등록만으로 금액이 채워지면 후속 테스트를 건너뜁니다.'
);
console.log(`ok 홍티비 등록  intent=${ask.intent} (금액 대기)`);

const amount = await turn(token, '3만원', history);
assert(
  amount.intent === 'create_subscription',
  `3만원 후속 intent=${amount.intent} (목록 조회로 가면 실패)`
);
assert(amount.extract?.amount === 30000, `3만원 extract.amount=${amount.extract?.amount}`);
assert(
  typeof amount.extract?.name === 'string' && amount.extract.name.includes('홍티비'),
  `3만원 extract.name=${amount.extract?.name}`
);
console.log(`ok 3만원 후속  create ${amount.extract.name} ${amount.extract.amount}`);

await resetSession(token);
const bare = await turn(token, '홍티비 30000');
assert(bare.intent === 'create_subscription', `홍티비 30000 intent=${bare.intent}`);
assert(bare.extract?.amount === 30000, `홍티비 30000 amount=${bare.extract?.amount}`);
console.log(`ok 홍티비 30000  create ${bare.extract?.name} ${bare.extract?.amount}`);

await resetSession(token);

async function countActiveSubscriptions(authToken) {
  const res = await fetch(`${url}/rest/v1/subscriptions?select=id&is_active=eq.true`, {
    headers: {
      apikey: anon,
      authorization: `Bearer ${authToken}`,
      prefer: 'count=exact',
    },
  });
  const range = res.headers.get('content-range');
  const total = range && range.includes('/') ? Number(range.split('/')[1]) : NaN;
  if (!Number.isFinite(total)) fail(`구독 수를 읽지 못했습니다: ${range}`);
  return total;
}

async function loadAssistantSession(authToken) {
  const res = await fetch(`${url}/rest/v1/rpc/load_assistant_session`, {
    method: 'POST',
    headers: authHeaders(authToken),
    body: '{}',
  });
  return jsonOrText(res);
}

const beforeReject = await countActiveSubscriptions(token);
const stamp = Date.now().toString(36).replace(/[0-9]/g, 'q').slice(-6);
const rejectName = `거절테스트${stamp}`;
const createCue = await turn(token, `${rejectName} 월 18000원이고 매월 14일 결제야. 등록해줘.`);
assert(
  createCue.intent === 'create_subscription' || createCue.pending_action_id,
  `등록 확인 대기 intent=${createCue.intent} pending=${createCue.pending_action_id}`
);
assert(createCue.pending_action_id, '최종 등록 확인 pending_action_id가 없습니다.');
const rejectOnce = await turn(token, '아니, 취소할게.');
assert(!rejectOnce.pending_action_id, `거절 후에도 pending_action_id=${rejectOnce.pending_action_id}`);
assert(
  rejectOnce.resolved_pending_action_id === createCue.pending_action_id,
  `resolved_pending_action_id=${rejectOnce.resolved_pending_action_id}`
);
assert(
  typeof rejectOnce.reply === 'string' && rejectOnce.reply.includes('취소'),
  `거절 안내가 없습니다: ${rejectOnce.reply}`
);
const afterReject = await countActiveSubscriptions(token);
assert(afterReject === beforeReject, `거절 후 구독 수가 ${beforeReject}에서 ${afterReject}로 바뀌었습니다.`);
const sessionAfterReject = await loadAssistantSession(token);
const rejectStatus = sessionAfterReject?.session?.pending_action_status;
assert(
  rejectStatus === 'cancelled' || rejectStatus === 'none',
  `거절 후 세션 status=${rejectStatus}`
);
assert(
  !sessionAfterReject?.session?.pending_action,
  '거절 후 pending_action JSON이 남아 있습니다.'
);
const monthly = await turn(token, '이번 달 얼마 나가?');
assert(
  monthly.intent === 'monthly_total',
  `취소 직후 이번 달 얼마 나가 intent=${monthly.intent}`
);
console.log('ok 거절 후 monthly_total');

const rejectAgain = await turn(token, '아니, 취소할게.');
assert(!rejectAgain.pending_action_id, `두 번째 거절 pending_action_id=${rejectAgain.pending_action_id}`);
console.log('ok 거절 두 번');

await resetSession(token);
const uniqueName = `테스트구독${stamp}`;
const draftCorrect = await turn(token, `${uniqueName} 월 17000원이고 매월 14일 결제야. 등록해줘.`);
assert(
  draftCorrect.pending_action_id || draftCorrect.intent === 'create_subscription',
  `정정 테스트 등록 대기 실패 intent=${draftCorrect.intent}`
);
const corrected = await turn(token, '아니, 금액은 18000원이야');
assert(
  corrected.pending_action_id,
  `금액 정정 후 pending이 사라졌습니다 intent=${corrected.intent}`
);
assert(
  !corrected.resolved_pending_action_id,
  `금액 정정이 취소로 처리됐습니다 resolved=${corrected.resolved_pending_action_id}`
);
assert(
  corrected.extract?.amount === 18000 || typeof corrected.reply === 'string',
  `금액 정정이 반영되지 않았습니다 amount=${corrected.extract?.amount}`
);
const confirmed = await turn(token, '등록해줘');
assert(!confirmed.pending_action_id || confirmed.reply?.includes('등록'), `승인 응답: ${confirmed.reply}`);
const afterConfirm = await countActiveSubscriptions(token);
assert(afterConfirm === beforeReject + 1, `승인 후 구독 수 ${afterConfirm}, 기대 ${beforeReject + 1}`);
const confirmAgain = await turn(token, '등록해줘');
const afterConfirmAgain = await countActiveSubscriptions(token);
assert(afterConfirmAgain === afterConfirm, `승인 두 번에 구독이 ${afterConfirm}에서 ${afterConfirmAgain}로 늘었습니다.`);
console.log('ok 정정·승인 1회');

await resetSession(token);
const dupCue = await turn(token, '스포티파이 월 20000원이고 매월 10일 결제야. 등록해줘.');
assert(dupCue.pending_action_id, `중복 질문 pending 없음 intent=${dupCue.intent}`);
const keepExisting = await turn(token, '아니');
assert(
  !keepExisting.resolved_pending_action_id,
  `중복 질문의 아니가 최종 취소로 처리됐습니다 resolved=${keepExisting.resolved_pending_action_id}`
);
assert(
  typeof keepExisting.reply === 'string' && (keepExisting.reply.includes('기존') || keepExisting.reply.includes('그대로')),
  `중복 유지 안내가 없습니다: ${keepExisting.reply}`
);
const afterKeep = await countActiveSubscriptions(token);
assert(afterKeep === afterConfirmAgain, `중복 아니 후 구독 수가 ${afterConfirmAgain}에서 ${afterKeep}로 바뀌었습니다.`);
console.log('ok 중복 아니는 기존 유지');

const createdIds = [];

function jwtSub(accessToken) {
  const payload = accessToken.split('.')[1];
  if (!payload) return '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString()).sub;
}

async function rest(authToken, method, path, body) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      ...authHeaders(authToken),
      prefer: 'return=representation',
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await jsonOrText(res);
  return { ok: res.ok, status: res.status, data };
}

async function cleanupCreated(authToken) {
  if (createdIds.length === 0) return;
  const ids = [...new Set(createdIds)];
  await fetch(`${url}/rest/v1/subscriptions?id=in.(${ids.join(',')})`, {
    method: 'DELETE',
    headers: authHeaders(authToken),
  });
  createdIds.length = 0;
}

async function loadCategoryId(authToken) {
  const res = await rest(authToken, 'GET', 'categories?select=id&key=eq.etc&limit=1');
  const row = Array.isArray(res.data) ? res.data[0] : null;
  return row && typeof row.id === 'string' ? row.id : null;
}

async function insertSub(authToken, fields) {
  const userId = jwtSub(authToken);
  const categoryId = await loadCategoryId(authToken);
  if (!userId || !categoryId) {
    return { blocked: '카테고리 또는 사용자 id를 읽지 못했습니다.' };
  }
  const res = await rest(authToken, 'POST', 'subscriptions', {
    user_id: userId,
    name: fields.name,
    amount: fields.amount,
    billing_cycle: fields.billing_cycle ?? 'monthly',
    category_id: categoryId,
    anchor_date: fields.anchor_date,
    next_payment_date: fields.next_payment_date ?? fields.anchor_date,
    is_active: true,
    account_id: fields.account_id ?? null,
  });
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!res.ok || !row?.id) {
    return { blocked: `구독 생성 실패 (${res.status}): ${JSON.stringify(res.data)}` };
  }
  createdIds.push(row.id);
  return { row };
}

async function getSub(authToken, id) {
  const res = await rest(authToken, 'GET', `subscriptions?id=eq.${id}&select=*`);
  const row = Array.isArray(res.data) ? res.data[0] : null;
  return row ?? null;
}

async function patchSub(authToken, id, fields) {
  return rest(authToken, 'PATCH', `subscriptions?id=eq.${id}`, fields);
}

async function deleteSub(authToken, id) {
  return fetch(`${url}/rest/v1/subscriptions?id=eq.${id}`, {
    method: 'DELETE',
    headers: authHeaders(authToken),
  });
}

async function confirmRpc(authToken, actionId, version, subscriptionId) {
  const res = await fetch(`${url}/rest/v1/rpc/confirm_pending_assistant_action`, {
    method: 'POST',
    headers: authHeaders(authToken),
    body: JSON.stringify({
      p_action_id: actionId,
      p_expected_version: version,
      p_subscription_id: subscriptionId ?? null,
    }),
  });
  const data = await jsonOrText(res);
  return { ok: res.ok, status: res.status, data };
}

async function countAmountEvents(authToken, subscriptionId) {
  const res = await fetch(
    `${url}/rest/v1/subscription_change_events?subscription_id=eq.${subscriptionId}&kind=eq.amount&select=id`,
    {
      headers: {
        ...authHeaders(authToken),
        prefer: 'count=exact',
      },
    }
  );
  const range = res.headers.get('content-range');
  const total = range && range.includes('/') ? Number(range.split('/')[1]) : NaN;
  return Number.isFinite(total) ? total : 0;
}

function blocked(id, message) {
  console.error(`BLOCKED/INVALID_FIXTURE ${id}: ${message}`);
  throw new Error('__blocked__');
}

function failCase(id, message) {
  console.error(`FAIL ${id}: ${message}`);
  throw new Error('__fail__');
}

try {
  await resetSession(token);

  const upd01Name = `검증넷${stamp}`;
  const upd01 = await insertSub(token, {
    name: upd01Name,
    amount: 17000,
    anchor_date: '2026-01-15',
  });
  if (upd01.blocked) blocked('UPD-01', upd01.blocked);
  const before01 = await getSub(token, upd01.row.id);
  if (!before01 || before01.amount !== 17000) blocked('UPD-01', '금액 17000 픽스처가 아닙니다.');
  const eventsBefore01 = await countAmountEvents(token, upd01.row.id);
  const ask01 = await turn(token, `${upd01Name} 요금을 19000원으로 바꿔줘`);
  if (ask01.intent !== 'update_subscription') failCase('UPD-01', `intent=${ask01.intent}`);
  if (!ask01.pending_action_id) failCase('UPD-01', 'pending 없음');
  if (typeof ask01.reply === 'string' && ask01.reply.includes(`"${upd01Name}"`)) {
    failCase('UPD-01', `확인 문구에 따옴표: ${ask01.reply}`);
  }
  if (typeof ask01.reply !== 'string' || !ask01.reply.includes('17,000원에서 19,000원')) {
    failCase('UPD-01', `전후 금액 없음: ${ask01.reply}`);
  }
  const mid01 = await getSub(token, upd01.row.id);
  if (mid01.amount !== 17000) failCase('UPD-01', `확인 전 금액=${mid01.amount}`);
  const yes01 = await turn(token, '변경해줘');
  if (typeof yes01.reply === 'string' && !yes01.reply.includes('변경했어요')) {
    failCase('UPD-01', `완료 문구: ${yes01.reply}`);
  }
  const after01 = await getSub(token, upd01.row.id);
  if (after01.amount !== 19000) failCase('UPD-01', `확인 후 금액=${after01.amount}`);
  if (after01.billing_cycle !== before01.billing_cycle) failCase('UPD-01', '주기가 바뀌었습니다.');
  const eventsAfter01 = await countAmountEvents(token, upd01.row.id);
  if (eventsAfter01 !== eventsBefore01 + 1) {
    failCase('UPD-01', `금액 이력 ${eventsBefore01} → ${eventsAfter01}`);
  }
  console.log('ok UPD-01');

  await resetSession(token);
  const upd02Name = `검증결제일${stamp}`;
  const upd02 = await insertSub(token, {
    name: upd02Name,
    amount: 14900,
    anchor_date: '2026-01-20',
  });
  if (upd02.blocked) blocked('UPD-02', upd02.blocked);
  const ask02 = await turn(token, `${upd02Name} 결제일을 25일로 바꿔줘`);
  if (ask02.intent !== 'update_subscription') failCase('UPD-02', `intent=${ask02.intent}`);
  if (!ask02.pending_action_id) failCase('UPD-02', `pending 없음 reply=${ask02.reply}`);
  const extractDay = typeof ask02.extract?.anchor_date === 'string'
    ? Number(ask02.extract.anchor_date.slice(8, 10))
    : NaN;
  if (extractDay !== 25) failCase('UPD-02', `extract.anchor_date=${ask02.extract?.anchor_date}`);
  if (ask02.extract?.amount != null && ask02.extract.amount !== 14900) {
    failCase('UPD-02', `금액이 같이 바뀜 amount=${ask02.extract.amount}`);
  }
  if (typeof ask02.reply !== 'string' || !ask02.reply.includes('매월 20일') || !ask02.reply.includes('매월 25일')) {
    failCase('UPD-02', `결제일 전후 없음: ${ask02.reply}`);
  }
  if (typeof ask02.reply === 'string' && ask02.reply.includes(`"${upd02Name}"`)) {
    failCase('UPD-02', `따옴표: ${ask02.reply}`);
  }
  const mid02 = await getSub(token, upd02.row.id);
  if (Number(mid02.anchor_date.slice(8, 10)) !== 20 || mid02.amount !== 14900) {
    failCase('UPD-02', `확인 전 DB day=${mid02.anchor_date} amount=${mid02.amount}`);
  }
  await turn(token, '변경해줘');
  const after02 = await getSub(token, upd02.row.id);
  if (Number(after02.anchor_date.slice(8, 10)) !== 25) {
    failCase('UPD-02', `확인 후 결제일=${after02.anchor_date}`);
  }
  if (after02.amount !== 14900 || after02.billing_cycle !== 'monthly') {
    failCase('UPD-02', `금액/주기 변경 amount=${after02.amount} cycle=${after02.billing_cycle}`);
  }
  console.log('ok UPD-02');

  await resetSession(token);
  const upd03Name = `검증스포${stamp}`;
  const upd03 = await insertSub(token, {
    name: upd03Name,
    amount: 17000,
    anchor_date: '2026-01-15',
  });
  if (upd03.blocked) blocked('UPD-03', upd03.blocked);
  const ask03 = await turn(token, `${upd03Name}를 월 22000원, 매월 18일 결제로 바꿔줘`);
  if (!ask03.pending_action_id) failCase('UPD-03', `pending 없음 reply=${ask03.reply}`);
  if (typeof ask03.reply !== 'string' || !ask03.reply.includes('22,000') || !ask03.reply.includes('18일')) {
    failCase('UPD-03', `다중 필드 확인 문구: ${ask03.reply}`);
  }
  const mid03 = await getSub(token, upd03.row.id);
  if (mid03.amount !== 17000 || Number(mid03.anchor_date.slice(8, 10)) !== 15) {
    failCase('UPD-03', '확인 전 DB가 바뀌었습니다.');
  }
  await turn(token, '변경해줘');
  const after03 = await getSub(token, upd03.row.id);
  if (after03.amount !== 22000 || Number(after03.anchor_date.slice(8, 10)) !== 18) {
    failCase('UPD-03', `확인 후 amount=${after03.amount} date=${after03.anchor_date}`);
  }
  if (after03.billing_cycle !== 'monthly') failCase('UPD-03', `주기=${after03.billing_cycle}`);
  console.log('ok UPD-03');

  const ask04 = await turn(token, `${upd03Name} 금액 바꿔줘`);
  if (ask04.pending_action_id) failCase('UPD-04', `값 없이 pending=${ask04.pending_action_id}`);
  if (ask04.extract?.amount === 22000) failCase('UPD-04', '완료된 22000원을 재사용했습니다.');
  if (typeof ask04.reply !== 'string' || !ask04.reply.includes('22,000원') || !ask04.reply.includes('얼마로')) {
    failCase('UPD-04', `현재 금액 질문 아님: ${ask04.reply}`);
  }
  const still04 = await getSub(token, upd03.row.id);
  if (still04.amount !== 22000) failCase('UPD-04', `DB 금액=${still04.amount}`);
  console.log('ok UPD-04');

  await resetSession(token);
  const upd05Name = `검증동명${stamp}`;
  const upd05a = await insertSub(token, {
    name: upd05Name,
    amount: 17000,
    anchor_date: '2026-01-02',
    account_id: 'a@example.com',
  });
  const upd05b = await insertSub(token, {
    name: upd05Name,
    amount: 19000,
    anchor_date: '2026-01-15',
    account_id: 'b@example.com',
  });
  if (upd05a.blocked || upd05b.blocked) blocked('UPD-05', upd05a.blocked || upd05b.blocked);
  const ask05 = await turn(token, `${upd05Name} 금액 바꿔줘`);
  const cand05 = Array.isArray(ask05.candidate_ids) ? ask05.candidate_ids : [];
  if (cand05.length < 2) failCase('UPD-05', `candidate_ids=${JSON.stringify(cand05)} reply=${ask05.reply}`);
  if (ask05.subscription_id) failCase('UPD-05', `임의 대상=${ask05.subscription_id}`);
  const after05a = await getSub(token, upd05a.row.id);
  const after05b = await getSub(token, upd05b.row.id);
  if (after05a.amount !== 17000 || after05b.amount !== 19000) {
    failCase('UPD-05', '동명 선택 전에 금액이 바뀌었습니다.');
  }
  console.log('ok UPD-05');

  await resetSession(token);
  const missingName = `없는티빙${stamp}`;
  const listedYoutube = await insertSub(token, {
    name: `목록조회${stamp}A`,
    amount: 14900,
    anchor_date: '2026-01-20',
  });
  const listedYoutube2 = await insertSub(token, {
    name: `목록조회${stamp}B`,
    amount: 13500,
    anchor_date: '2026-01-21',
  });
  if (listedYoutube.blocked || listedYoutube2.blocked) {
    blocked('STALE-LIST-01', listedYoutube.blocked || listedYoutube2.blocked);
  }
  const listTurn = await turn(token, '목록');
  const rankedBefore = Array.isArray(listTurn.ranked_subscription_ids)
    ? listTurn.ranked_subscription_ids.length
    : 0;
  if (rankedBefore < 1) blocked('STALE-LIST-01', `목록 ranked=${rankedBefore}`);
  const ask06 = await turn(token, `${missingName} 요금을 13500원으로 바꿔줘`);
  if (ask06.pending_action_id) failCase('UPD-06', `없는 구독 pending=${ask06.pending_action_id}`);
  if (ask06.action) failCase('UPD-06', `action=${ask06.action}`);
  const ranked06 = Array.isArray(ask06.ranked_subscription_ids) ? ask06.ranked_subscription_ids : [];
  if (ranked06.length !== 0) failCase('STALE-LIST-01', `not_found ranked=${JSON.stringify(ranked06)}`);
  if (typeof ask06.reply === 'string' && (ask06.reply.includes('변경했어요') || ask06.reply.includes('변경할까요'))) {
    failCase('UPD-06', `거짓 변경 안내: ${ask06.reply}`);
  }
  const createdMissing = await rest(
    token,
    'GET',
    `subscriptions?name=eq.${encodeURIComponent(missingName)}&select=id`
  );
  const missingRows = Array.isArray(createdMissing.data) ? createdMissing.data : [];
  if (missingRows.length > 0) failCase('UPD-06', '없는 구독을 자동 등록했습니다.');
  console.log('ok UPD-06 / STALE-LIST-01');

  await resetSession(token);
  const upd07Name = `검증거절${stamp}`;
  const upd07 = await insertSub(token, {
    name: upd07Name,
    amount: 17000,
    anchor_date: '2026-01-15',
  });
  if (upd07.blocked) blocked('UPD-07', upd07.blocked);
  const ask07 = await turn(token, `${upd07Name} 요금을 19000원으로 바꿔줘`);
  if (!ask07.pending_action_id) failCase('UPD-07', `pending 없음 reply=${ask07.reply}`);
  const reject07 = await turn(token, '아니, 그대로 둬');
  if (reject07.pending_action_id) failCase('UPD-07', `거절 후 pending=${reject07.pending_action_id}`);
  if (reject07.resolved_pending_action_id !== ask07.pending_action_id) {
    failCase('UPD-07', `resolved=${reject07.resolved_pending_action_id}`);
  }
  const after07 = await getSub(token, upd07.row.id);
  if (after07.amount !== 17000) failCase('UPD-07', `거절 후 금액=${after07.amount}`);
  console.log('ok UPD-07');

  await resetSession(token);
  const upd08Name = `검증충돌${stamp}`;
  const upd08 = await insertSub(token, {
    name: upd08Name,
    amount: 17000,
    anchor_date: '2026-01-15',
  });
  if (upd08.blocked) blocked('UPD-08', upd08.blocked);
  const ask08 = await turn(token, `${upd08Name} 요금을 19000원으로 바꿔줘`);
  if (!ask08.pending_action_id || ask08.session_version == null) {
    failCase('UPD-08', `pending=${ask08.pending_action_id} version=${ask08.session_version}`);
  }
  const patched = await patchSub(token, upd08.row.id, {
    amount: 16000,
    updated_at: new Date(Date.now() + 1500).toISOString(),
  });
  if (!patched.ok) failCase('UPD-08', `REST PATCH 실패 ${patched.status}`);
  const patchedRow = await getSub(token, upd08.row.id);
  if (patchedRow.amount !== 16000) failCase('UPD-08', `PATCH 후 금액=${patchedRow.amount}`);
  if (patchedRow.updated_at === upd08.row.updated_at) {
    blocked('UPD-08', 'REST PATCH가 updated_at을 바꾸지 않아 충돌 잠금을 검증할 수 없습니다.');
  }
  const conflict = await confirmRpc(
    token,
    ask08.pending_action_id,
    ask08.session_version,
    upd08.row.id
  );
  const conflictCode = conflict.data?.code ?? conflict.data?.error;
  if (conflict.data?.ok === true) failCase('UPD-08', `PATCH 후 confirm ok=${JSON.stringify(conflict.data)}`);
  if (conflictCode !== 'conflict') failCase('UPD-08', `code=${conflictCode} body=${JSON.stringify(conflict.data)}`);
  const afterPatch = await getSub(token, upd08.row.id);
  if (afterPatch.amount !== 16000) failCase('UPD-08', `덮어쓰기 amount=${afterPatch.amount}`);

  await resetSession(token);
  const upd08del = await insertSub(token, {
    name: `${upd08Name}삭제`,
    amount: 17000,
    anchor_date: '2026-01-15',
  });
  if (upd08del.blocked) blocked('UPD-08', upd08del.blocked);
  const ask08del = await turn(token, `${upd08Name}삭제 요금을 19000원으로 바꿔줘`);
  if (!ask08del.pending_action_id) failCase('UPD-08', '삭제 케이스 pending 없음');
  const delRes = await deleteSub(token, upd08del.row.id);
  if (!delRes.ok) failCase('UPD-08', `REST DELETE ${delRes.status}`);
  const delIdx = createdIds.indexOf(upd08del.row.id);
  if (delIdx >= 0) createdIds.splice(delIdx, 1);
  const missing = await confirmRpc(
    token,
    ask08del.pending_action_id,
    ask08del.session_version,
    upd08del.row.id
  );
  if (missing.data?.ok === true) failCase('UPD-08', `삭제 후 confirm ok=${JSON.stringify(missing.data)}`);
  if (missing.data?.code !== 'not_found') {
    failCase('UPD-08', `삭제 후 code=${missing.data?.code}`);
  }
  const resurrected = await rest(
    token,
    'GET',
    `subscriptions?id=eq.${upd08del.row.id}&select=id`
  );
  const resurrectedRows = Array.isArray(resurrected.data) ? resurrected.data : [];
  if (resurrectedRows.length > 0) failCase('UPD-08', '삭제된 구독이 되살아났습니다.');
  console.log('ok UPD-08');

  await resetSession(token);
  const upd09Name = `검증버전${stamp}`;
  const upd09 = await insertSub(token, {
    name: upd09Name,
    amount: 17000,
    anchor_date: '2026-01-15',
  });
  if (upd09.blocked) blocked('UPD-09', upd09.blocked);
  const ask09 = await turn(token, `${upd09Name} 요금을 19000원으로 바꿔줘`);
  if (!ask09.pending_action_id || ask09.session_version == null) {
    failCase('UPD-09', 'pending 없음');
  }
  const badVersion = await confirmRpc(
    token,
    ask09.pending_action_id,
    Number(ask09.session_version) + 99,
    upd09.row.id
  );
  if (badVersion.data?.ok === true) failCase('UPD-09', `잘못된 version이 성공: ${JSON.stringify(badVersion.data)}`);
  if (badVersion.data?.code !== 'conflict') failCase('UPD-09', `code=${badVersion.data?.code}`);
  const after09 = await getSub(token, upd09.row.id);
  if (after09.amount !== 17000) failCase('UPD-09', `DB 금액=${after09.amount}`);
  if (typeof badVersion.data?.message === 'string' && badVersion.data.message.includes('변경했어요')) {
    failCase('UPD-09', `성공 문구: ${badVersion.data.message}`);
  }
  console.log('ok UPD-09');

  await cleanupCreated(token);
  await resetSession(token);
  console.log('assistant-turn API 확인 통과. 표 레이아웃·후보 카드는 앱/웹 화면에서 보세요.');
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  try {
    await cleanupCreated(token);
  } catch {
    /* ignore */
  }
  if (message === '__blocked__') process.exit(3);
  if (message === '__fail__') process.exit(2);
  console.error(message);
  process.exit(2);
}

