import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient } from '@supabase/supabase-js';

// subly/{platform}/{version}/subly-{platform}-{version}-{versionCode}.{apk|ipa} 형태만 서명 대상으로 허용한다.
const KEY_PATTERN = /^subly\/(android|ios)\/[\w.-]+\/subly-(android|ios)-[\w.-]+-\d+\.(apk|ipa)$/;

interface Env {
  ASSETS: Fetcher;
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_ANON_KEY: string;
  SUBLY_AWS_REGION: string;
  SUBLY_AWS_ACCESS_KEY_ID: string;
  SUBLY_AWS_SECRET_ACCESS_KEY: string;
  SUBLY_S3_BUCKET: string;
}

async function handleDownloadRelease(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const explicitKey = url.searchParams.get('key');
  const platform = url.searchParams.get('platform');

  let storagePath: string | null = null;

  if (explicitKey && KEY_PATTERN.test(explicitKey)) {
    storagePath = explicitKey;
  } else if (platform === 'android' || platform === 'ios') {
    const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
    const { data } = await supabase
      .from('app_releases')
      .select('storage_path')
      .eq('platform', platform)
      .eq('is_current', true)
      .maybeSingle();
    storagePath = data?.storage_path ?? null;
  }

  if (!storagePath) {
    return new Response('Not found', { status: 404 });
  }

  const s3 = new S3Client({
    region: env.SUBLY_AWS_REGION,
    credentials: {
      accessKeyId: env.SUBLY_AWS_ACCESS_KEY_ID,
      secretAccessKey: env.SUBLY_AWS_SECRET_ACCESS_KEY,
    },
  });
  const command = new GetObjectCommand({ Bucket: env.SUBLY_S3_BUCKET, Key: storagePath });
  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  return Response.redirect(signedUrl, 302);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/download-release' && request.method === 'GET') {
      return handleDownloadRelease(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
