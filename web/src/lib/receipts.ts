import { extensionFor } from '@/lib/image';
import { supabase } from '@/lib/supabase';

export async function uploadReceipt(file: File, mimeType: string, fileName: string): Promise<{
  storagePath: string;
  uploadId: string;
}> {
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth.session?.user?.id;
  if (!userId) {
    throw new Error('로그인이 필요합니다.');
  }

  const ext = extensionFor(mimeType, fileName);
  const storagePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: uploadError } = await supabase.storage.from('receipts').upload(storagePath, file, {
    contentType: mimeType,
    upsert: false,
  });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data, error } = await supabase
    .from('receipt_uploads')
    .insert({
      user_id: userId,
      storage_path: storagePath,
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? '업로드 기록을 남기지 못했습니다.');
  }

  return { storagePath, uploadId: data.id as string };
}

export async function saveReceiptParse(
  uploadId: string,
  parsed: unknown,
  subscriptionId?: string
): Promise<void> {
  const { error } = await supabase
    .from('receipt_uploads')
    .update({
      parsed_result: parsed,
      subscription_id: subscriptionId ?? null,
    })
    .eq('id', uploadId);

  if (error) {
    throw new Error(error.message);
  }
}
