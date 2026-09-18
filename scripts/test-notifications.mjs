// ChatGPT 수정: 실제 푸시/운영 DB 없이 실행하는 알림 회귀 테스트.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
function loadTS(path, mocks = {}, extra = '', globals = {}) {
  const source = readFileSync(new URL(path, root), 'utf8') + extra;
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(output, {
    exports, require: (name) => {
      if (!(name in mocks)) throw new Error('Unmocked import: ' + name);
      return mocks[name];
    }, console, Response, AbortSignal, fetch, setTimeout, clearTimeout, atob, ...globals,
  }, { filename: path });
  return exports;
}

const { sendPushBatch } = loadTS('supabase/functions/_shared/notification-push.ts');
const categoryNames = loadTS('lib/category-name.ts');
const assistantQueries = loadTS('supabase/functions/assistant-turn/queries.ts', {
  'jsr:@supabase/supabase-js@2': {},
});
const assistantIntent = loadTS('supabase/functions/assistant-turn/gemini-intent.ts', {
  './queries.ts': assistantQueries,
  '../_shared/claude.ts': {
    claudeText: async () => null,
    parseClaudeJson: JSON.parse,
  },
});
test('category names normalize consistently and reject special characters', () => {
  assert.equal(categoryNames.normalizeCategoryDisplayName('  ＯＴＴ   비용  '), 'OTT 비용');
  assert.equal(categoryNames.normalizeCategorySearchKey('생 활! 비'), '생활비');
  assert.equal(categoryNames.validateCategoryName('생활!비').name, null);
  assert.equal(categoryNames.validateCategoryName('생활 비').name, '생활 비');
});
test('assistant finds legacy special-character categories by normalized mention', () => {
  // ChatGPT 수정: Deno가 없는 로컬 환경에서도 카테고리 인식 회귀를 실제 실행한다.
  const categories = [
    { id: 'short', name: '생활', key: null, normalized_name: '생활' },
    { id: 'legacy', name: '생활!비', key: null, normalized_name: '생활비' },
  ];
  assert.equal(assistantQueries.findMentionedCategory(categories, '생활비에 뭐가 있어?')?.id, 'legacy');
});
test('duplicate confirmation treats a short affirmative only in duplicate state', () => {
  // ChatGPT 수정: "네"가 새 서비스명으로 오인되는 회귀를 별도 상태 조건까지 검증한다.
  assert.equal(assistantIntent.isDuplicateAffirmativeUtterance('네', true), true);
  assert.equal(assistantIntent.isDuplicateAffirmativeUtterance('좋아요', true), true);
  assert.equal(assistantIntent.isDuplicateAffirmativeUtterance('네', false), false);
});
test('assistant state-machine TypeScript transpiles without syntax errors', () => {
  for (const path of [
    'supabase/functions/assistant-turn/index.ts',
    'supabase/functions/assistant-turn/gemini-intent.ts',
    'supabase/functions/assistant-turn/queries.ts',
  ]) {
    const source = readFileSync(new URL(path, root), 'utf8');
    const result = ts.transpileModule(source, {
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: path,
    });
    const errors = (result.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, errors.map((item) => item.messageText).join('\n'));
  }
});
test('Edge Function TypeScript checks against installed Supabase client types', () => {
  const virtualPath = fileURLToPath(new URL('scripts/notification-test-runtime.d.ts', root));
  const declarations = `
    declare module 'jsr:@supabase/functions-js/edge-runtime.d.ts' {}
    declare module 'jsr:@supabase/supabase-js@2' {
      import { createClient as client } from '@supabase/supabase-js';
      export const createClient: typeof client;
    }
    declare const Deno: { env: { get(name: string): string | undefined };
      serve(handler: (req: Request) => Response | Promise<Response>): void };
  `;
  const options = { strict: true, noEmit: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (path, version, onError, fresh) => path === virtualPath
    ? ts.createSourceFile(path, declarations, version) : original(path, version, onError, fresh);
  const paths = ['generate-payment-notifications', 'check-notification-receipts']
    .map((name) => fileURLToPath(new URL('supabase/functions/' + name + '/index.ts', root)));
  const program = ts.createProgram([...paths, virtualPath], options, host);
  const errors = ts.getPreEmitDiagnostics(program);
  assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: (path) => path, getCurrentDirectory: () => fileURLToPath(root), getNewLine: () => '\n',
  }));
});
const messages = [{ to: 'ExponentPushToken[test]', title: 'test', body: 'test', data: {}, channelId: 'payment-reminders-v2', badge: 75, sound: 'default' }];
function generatorHarness() {
  let handler;
  const calls = [];
  const job = { id: 'job', notification_id: 'notice', device_id: 'device', user_id: 'user',
    token: 'ExponentPushToken[test]', title: 'title', body: 'body', subscription_id: 'sub', claim_token: 'claim', badge: 75 };
  const query = { select: () => query, eq: () => query, order: () => query, range: async () => ({ data: [], error: null }) };
  const exports = loadTS('supabase/functions/generate-payment-notifications/index.ts', {
    'jsr:@supabase/functions-js/edge-runtime.d.ts': {},
    'jsr:@supabase/supabase-js@2': { createClient: () => ({
      from: () => query,
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: name === 'claim_notification_deliveries' ? [job]
          : name === 'start_notification_deliveries' ? [{ id: job.id }] : null, error: null };
      },
    }) },
    '../_shared/notification-push.ts': { sendPushBatch: async (batch) => {
      calls.push({ name: 'send', args: batch });
      return [{ status: 'ticket_ok', ticket: 'ticket-1' }];
    } },
  }, '\nexport { nextPaymentDateYmd, parseYmd, kstHour, allowsReminder, isQuietHours };', {
    Deno: { env: { get: () => 'test-only' }, serve: (fn) => { handler = fn; } },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-13T01:00:00Z'])); } },
  });
  return { handler, calls, exports };
}
test('generator processes existing queue even when no new subscription notifications exist', async () => {
  const h = generatorHarness();
  const jwt = 'test.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.test';
  const response = await h.handler(new Request('https://test.invalid', { headers: { Authorization: 'Bearer ' + jwt } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { created: 0, attempted: 1, accepted: 1 });
  assert.equal(h.calls.find((call) => call.name === 'send').args[0].badge, 75);
  assert.equal(h.calls.at(-1).name, 'finish_notification_delivery');
});
test('KST midnight and monthly/yearly clamping remain correct', () => {
  const { nextPaymentDateYmd, parseYmd, kstHour } = generatorHarness().exports;
  assert.equal(kstHour(new Date('2026-09-12T15:00:00Z')), 0);
  assert.equal(kstHour(new Date('2026-09-13T00:00:00Z')), 9);
  assert.equal(JSON.stringify(nextPaymentDateYmd('2026-01-31', 'monthly', parseYmd('2026-02-01'))),
    JSON.stringify({ y: 2026, m: 2, d: 28 }));
  assert.equal(JSON.stringify(nextPaymentDateYmd('2024-02-29', 'yearly', parseYmd('2027-02-01'))),
    JSON.stringify({ y: 2027, m: 2, d: 28 }));
});
test('notification preferences and overnight quiet hours are deterministic', () => {
  const { allowsReminder, isQuietHours } = generatorHarness().exports;
  const preference = {
    notifications_enabled: true, payment_due_enabled: true,
    payment_due_d3_enabled: false, payment_due_d1_enabled: true,
    push_enabled: true, quiet_hours_enabled: true,
    quiet_start: '21:00:00', quiet_end: '08:00:00', timezone: 'Asia/Seoul',
  };
  assert.equal(allowsReminder(preference, 3), false);
  assert.equal(allowsReminder(preference, 1), true);
  assert.equal(isQuietHours(preference, new Date('2026-09-13T13:00:00Z')), true);
  assert.equal(isQuietHours(preference, new Date('2026-09-12T23:00:00Z')), false);
});
for (const status of [429, 500, 503]) {
  test('HTTP ' + status + ' is retryable', async () => {
    const result = await sendPushBatch(messages, async () => new Response('', { status }));
    assert.equal(result[0].status, 'retry');
  });
}
test('network timeout and invalid response are unknown, not retry', async () => {
  assert.equal((await sendPushBatch(messages, async () => { throw new Error('timeout'); }))[0].status, 'unknown');
  assert.equal((await sendPushBatch(messages, async () => new Response('{}')))[0].status, 'unknown');
});
test('tickets distinguish success, rate limit and invalid token', async () => {
  for (const [ticket, status] of [
    [{ status: 'ok', id: 'ticket-1' }, 'ticket_ok'],
    [{ status: 'error', details: { error: 'MessageRateExceeded' } }, 'retry'],
    [{ status: 'error', details: { error: 'DeviceNotRegistered' } }, 'error'],
    [{ status: 'ok' }, 'unknown'],
  ]) {
    assert.equal((await sendPushBatch(messages, async () => Response.json({ data: [ticket] })))[0].status, status);
  }
});

function createStore(init) {
  let state;
  const listeners = [];
  const get = () => state;
  const set = (patch) => { const previous = state; state = { ...state, ...patch }; listeners.forEach((fn) => fn(state, previous)); };
  state = init(set, get);
  return Object.assign(() => state, { getState: get, setState: set, subscribe: (fn) => listeners.push(fn) });
}

function storeHarness() {
  const auth = createStore(() => ({ session: { user: { id: 'user-a' } } }));
  const rows = Array.from({ length: 75 }, (_, index) => ({ id: String(index), user_id: 'user-a', read_at: null }));
  let failUpdate = false;
  let hold = 0;
  const held = [];
  const badges = [];
  const supabase = { from: () => {
    let mode = 'select', limit = Infinity, exact = false, patch;
    const filters = [];
    const query = {
      select: (_columns, options) => { exact = options?.count === 'exact'; return query; },
      update: (value) => { mode = 'update'; patch = value; return query; },
      eq: (key, value) => { filters.push((row) => row[key] === value); return query; },
      is: (key, value) => { filters.push((row) => row[key] === value); return query; },
      order: () => query,
      limit: (value) => { limit = value; return query; },
      then: (resolve) => {
        const selected = rows.filter((row) => filters.every((filter) => filter(row)));
        if (mode === 'update') {
          if (failUpdate) return Promise.resolve({ error: { message: 'offline' } }).then(resolve);
          selected.forEach((row) => Object.assign(row, patch));
        }
        const result = { data: selected.slice(0, limit).map((row) => ({ ...row })), count: exact ? selected.length : null, error: null };
        if (hold > 0) {
          hold--;
          return new Promise((release) => held.push(() => release(result))).then(resolve);
        }
        return Promise.resolve(result).then(resolve);
      },
    };
    return query;
  } };
  const { useNotificationStore: store } = loadTS('stores/notification-store.ts', {
    'expo-notifications': { setBadgeCountAsync: async (count) => { badges.push(count); } },
    'react-native': { Platform: { OS: 'android' } },
    zustand: { create: createStore },
    '@/lib/supabase': { supabase },
    '@/stores/auth-store': { useAuthStore: auth },
  });
  return { store, auth, rows, badges, fail: () => { failUpdate = true; },
    delay: () => { hold = 2; }, release: () => held.splice(0).forEach((fn) => fn()) };
}
test('75 unread notifications keep badge 75 with list limited to 50; out-of-page read works', async () => {
  const h = storeHarness();
  await h.store.getState().fetchNotifications();
  assert.equal(h.store.getState().notifications.length, 50);
  assert.equal(h.store.getState().unreadCount, 75);
  await h.store.getState().markRead('74');
  assert.equal(h.store.getState().unreadCount, 74);
  await h.store.getState().markAllRead();
  assert.equal(h.store.getState().unreadCount, 0);
});
test('mark-all includes unread rows outside a fully-read first page', async () => {
  const h = storeHarness();
  h.rows.slice(0, 50).forEach((row) => { row.read_at = 'read'; });
  await h.store.getState().fetchNotifications();
  assert.equal(h.store.getState().unreadCount, 25);
  await h.store.getState().markAllRead();
  assert.equal(h.store.getState().unreadCount, 0);
});
test('failed read keeps count; logout resets list/count', async () => {
  const h = storeHarness();
  await h.store.getState().fetchNotifications();
  h.fail();
  await assert.rejects(h.store.getState().markAllRead(), /offline/);
  assert.equal(h.store.getState().unreadCount, 75);
  h.auth.setState({ session: null });
  assert.equal(h.store.getState().unreadCount, 0);
  assert.equal(h.store.getState().notifications.length, 0);
});

test('late fetch cannot overwrite a newer count or a signed-out session', async () => {
  const h = storeHarness();
  h.delay();
  const old = h.store.getState().fetchNotifications();
  await Promise.resolve();
  h.rows[0].read_at = 'read';
  await h.store.getState().fetchNotifications();
  h.release();
  await old;
  assert.equal(h.store.getState().unreadCount, 74);
  h.delay();
  const pending = h.store.getState().fetchNotifications();
  await Promise.resolve();
  h.auth.setState({ session: null });
  h.release();
  await pending;
  assert.equal(h.store.getState().unreadCount, 0);
  assert.equal(h.store.getState().notifications.length, 0);
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 20));
test('cold-start + live response navigates once, marks read, clears cache, never uses payload path', async () => {
  let callback, last, saved;
  const paths = [], readIds = [];
  const auth = createStore(() => ({ session: { user: { id: 'user-a' } } }));
  const response = { notification: { request: { identifier: 'response-1', content: { data: {
    notificationId: '00000000-0000-0000-0000-000000000001', targetPath: '//evil.invalid',
  } } } } };
  last = response;
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({
    data: { id: response.notification.request.content.data.notificationId, subscription_id: null }, error: null,
  }) };
  const { attachNotificationResponseListener } = loadTS('lib/notifications.ts', {
    '@react-native-async-storage/async-storage': { getItem: async () => saved, setItem: async (_key, value) => { saved = value; } },
    'expo-constants': {},
    'expo-notifications': {
      setNotificationHandler: () => {},
      addNotificationResponseReceivedListener: (fn) => { callback = fn; return { remove() {} }; },
      getLastNotificationResponseAsync: async () => last,
      clearLastNotificationResponseAsync: async () => { last = null; },
    },
    'expo-router': { router: { push: (path) => paths.push(path) } },
    'react-native': { Platform: { OS: 'android' }, AppState: { addEventListener: () => ({ remove() {} }) } },
    '@/lib/supabase': { supabase: { from: () => query } },
    '@/stores/auth-store': { useAuthStore: auth },
    '@/stores/notification-store': { useNotificationStore: { getState: () => ({ markRead: async (id) => readIds.push(id) }) } },
  });
  attachNotificationResponseListener(null);
  assert.equal(callback, undefined);
  const detach = attachNotificationResponseListener('user-a');
  callback(response);
  await flush();
  assert.deepEqual(paths, ['/notifications']);
  assert.equal(readIds.length, 1);
  assert.equal(last, null);
  detach();
  last = response;
  attachNotificationResponseListener('user-a');
  await flush();
  assert.equal(paths.length, 1);
  assert.equal(last, null);
});

if (process.argv.includes('--database')) {
  test('isolated PostgreSQL migration, retry lifecycle and concurrent claim', async () => {
    const fixture = readFileSync(new URL('scripts/test-notifications.sql', root), 'utf8');
    const initial = readFileSync(new URL('supabase/migrations/20260912160000_notifications.sql', root), 'utf8');
    const migration = readFileSync(new URL('supabase/migrations/20260912160201_notification_delivery_retries.sql', root), 'utf8');
    const preferencesMigration = readFileSync(new URL(
      'supabase/migrations/20260913151336_notification_preferences_and_category_names.sql', root), 'utf8');
    // Deterministic 10:00 KST; never alters the deployable migration or the host clock.
    const sql = fixture
      .replace('-- INITIAL_MIGRATION', () => initial)
      .replace('-- RETRY_MIGRATION', () =>
        migration.replaceAll('now()', "'2026-09-13 01:00:00+00'::timestamptz"))
      .replace('-- PREFERENCES_MIGRATION', () =>
        preferencesMigration.replaceAll('now()', "'2026-09-13 01:00:00+00'::timestamptz"));
    const result = execFileSync('docker', ['exec', '-i', 'subly-notification-review-test',
      'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
      input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    assert.match(result, /ROLLBACK/);
    // Separate connections test a real overlapping transaction, not a mocked row lock.
    const run = promisify(execFile);
    const args = ['exec', '-i', 'subly-notification-review-test', 'psql',
      '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
    const setup = sql.split('set local role service_role;')[0] + `
      insert into public.notification_devices(user_id,expo_push_token,platform)
        values ('00000000-0000-0000-0000-000000000001','ExponentPushToken[test]','android');
      commit;
    `;
    execFileSync('docker', args, { input: setup, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      const query = `begin; set local role service_role;
        set local request.jwt.claim.role='service_role';
        select count(*) from public.claim_notification_deliveries();
        select pg_sleep(0.1); commit;`;
      const outcomes = await Promise.all([1, 2].map(() => run('docker', [...args, '-Atc', query])));
      const counts = outcomes.map(({ stdout }) => Number(stdout.split('\n').find((line) => /^\d+$/.test(line)))).sort();
      assert.deepEqual(counts, [0, 1], 'only one worker may claim a delivery');
    } finally {
      // Dedicated disposable DB only; restore it for repeatable tests.
      execFileSync('docker', args, { input: `
        drop table public.notification_push_deliveries, public.notifications, public.notification_devices,
          public.notification_preferences, public.categories, public.subscriptions cascade;
        drop function public.notification_is_due(uuid,uuid,date,integer),
          public.claim_notification_deliveries(integer), public.validate_notification_delivery(uuid,uuid),
          public.start_notification_deliveries(jsonb), public.finish_notification_delivery(uuid,uuid,text,text,text,text),
          public.notification_inbox_enabled(uuid,integer), public.notification_push_enabled(uuid,integer),
          public.normalize_category_name(text), public.is_notification_device_enabled(text);
        delete from auth.users where id in ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');
      `, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    }
  });
}
