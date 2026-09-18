import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient } from '@supabase/supabase-js';

// subly/{platform}/{version}/subly-{platform}-{version}-{versionCode}.{apk|ipa} 형태만 서명 대상으로 허용한다.
const KEY_PATTERN = /^subly\/(android|ios)\/[\w.-]+\/subly-(android|ios)-[\w.-]+-\d+\.(apk|ipa)$/;

export default async (req: Request) => {
  const url = new URL(req.url);
  const explicitKey = url.searchParams.get('key');
  const platform = url.searchParams.get('platform');

  let storagePath: string | null = null;

  if (explicitKey && KEY_PATTERN.test(explicitKey)) {
    storagePath = explicitKey;
  } else if (platform === 'android' || platform === 'ios') {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL!,
      process.env.VITE_SUPABASE_ANON_KEY!
    );
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
    region: process.env.SUBLY_AWS_REGION,
    credentials: {
      accessKeyId: process.env.SUBLY_AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.SUBLY_AWS_SECRET_ACCESS_KEY!,
    },
  });
  const command = new GetObjectCommand({ Bucket: process.env.SUBLY_S3_BUCKET, Key: storagePath });
  const signedUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  return Response.redirect(signedUrl, 302);
};
