#!/usr/bin/env node
/**
 * Android APK를 AWS S3에 올리고 Supabase의 app_releases 테이블에 새 "현재 버전" 행을 기록한다.
 * 과거 버전은 지우지 않는다(append-only, 롤백 대비).
 *
 *   node scripts/publish-apk.mjs [--apk <path>] [--version <semver>] [--version-code <int>] [--skip-db]
 *
 * --version / --version-code를 생략하면 루트 app.json의 expo.version / expo.android.versionCode를 쓴다.
 * --skip-db는 S3 업로드만 하고 app_releases 테이블은 건드리지 않는다 (기존 버전 파일을 재업로드할 때 등).
 *
 * 필요한 값 (루트 .env):
 * - AWS_REGION, AWS_S3_BUCKET, AWS_PROFILE=chany-bespin-mfa
 *   (AWS_PROFILE로 지정한 프로파일은 `aws configure mfa-login ...`으로 미리 세션을 활성화해 둬야 함)
 * - SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL (DB 기록용, --skip-db면 불필요)
 */

import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

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

function fail(message) {
  console.error(message);
  process.exit(2);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    if (key === '--skip-db') {
      args['skip-db'] = true;
      continue;
    }
    args[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const skipDb = Boolean(args['skip-db']);

const region = process.env.AWS_REGION || '';
const bucket = process.env.AWS_S3_BUCKET || '';
if (!region || !bucket) {
  fail('.env 에 AWS_REGION / AWS_S3_BUCKET 이 필요합니다.');
}

const supabaseUrl = (
  process.env.VITE_SUPABASE_URL ||
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!skipDb) {
  if (!supabaseUrl) fail('web/.env 또는 .env 에 VITE_SUPABASE_URL 이 필요합니다.');
  if (!serviceRoleKey) {
    fail(
      [
        'web/.env 에 SUPABASE_SERVICE_ROLE_KEY 가 없습니다.',
        'Supabase Dashboard > Project Settings > API 에서 service_role 키를 복사해',
        'web/.env 에 SUPABASE_SERVICE_ROLE_KEY=... 로 추가해 주세요. (VITE_ 접두사 붙이지 말 것)',
      ].join('\n')
    );
  }
}

const appJson = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
const version = args.version || appJson.expo?.version;
const versionCode = Number(args['version-code'] || appJson.expo?.android?.versionCode);
const apkPath =
  args.apk || join(root, 'android/app/build/outputs/apk/release/app-release.apk');

if (!version) fail('버전을 확인할 수 없습니다 (--version 또는 app.json expo.version).');
if (!Number.isFinite(versionCode)) {
  fail('versionCode를 확인할 수 없습니다 (--version-code 또는 app.json expo.android.versionCode).');
}

let fileBuffer;
let fileSize;
try {
  fileBuffer = readFileSync(apkPath);
  fileSize = statSync(apkPath).size;
} catch (err) {
  fail(`APK 파일을 읽지 못했습니다: ${apkPath}\n${err instanceof Error ? err.message : err}`);
}

const storagePath = `subly/android/${version}/subly-android-${version}-${versionCode}.apk`;

// credentials를 안 넘기면 SDK가 AWS_PROFILE(.env에서 로드됨) 세션을 자동으로 찾는다.
const s3 = new S3Client({ region });

async function uploadApk() {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: storagePath }));
    fail(`이미 업로드된 버전입니다: ${storagePath} (버전/versionCode를 올려서 다시 시도하세요)`);
  } catch (err) {
    if (err?.name !== 'NotFound' && err?.$metadata?.httpStatusCode !== 404) {
      fail(`S3 확인 실패: ${err instanceof Error ? err.message : err}`);
    }
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storagePath,
      Body: fileBuffer,
      ContentType: 'application/vnd.android.package-archive',
    })
  );
}

function serviceHeaders(extra = {}) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    ...extra,
  };
}

async function jsonOrText(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function unsetCurrent() {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/app_releases?platform=eq.android&is_current=eq.true`,
    {
      method: 'PATCH',
      headers: serviceHeaders({ 'content-type': 'application/json', prefer: 'return=minimal' }),
      body: JSON.stringify({ is_current: false }),
    }
  );
  if (!res.ok) {
    const body = await jsonOrText(res);
    fail(`기존 현재 버전 해제 실패 (${res.status}): ${JSON.stringify(body)}`);
  }
}

async function insertRelease() {
  const res = await fetch(`${supabaseUrl}/rest/v1/app_releases`, {
    method: 'POST',
    headers: serviceHeaders({ 'content-type': 'application/json', prefer: 'return=representation' }),
    body: JSON.stringify({
      platform: 'android',
      version,
      version_code: versionCode,
      storage_path: storagePath,
      file_size: fileSize,
      is_current: true,
    }),
  });
  if (!res.ok) {
    const body = await jsonOrText(res);
    fail(`릴리스 기록 실패 (${res.status}): ${JSON.stringify(body)}`);
  }
}

await uploadApk();
if (!skipDb) {
  await unsetCurrent();
  await insertRelease();
}

console.log(`업로드 완료: v${version} (versionCode ${versionCode}), ${(fileSize / 1024 / 1024).toFixed(1)}MB`);
console.log(`S3 키: s3://${bucket}/${storagePath}`);
if (skipDb) console.log('(--skip-db: app_releases 테이블은 변경하지 않았습니다)');
