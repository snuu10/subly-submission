// ChatGPT 수정: 성공/명확한 일시 실패/전송 여부 불명확을 구분하는 테스트 가능한 전송 계층.
export type PushOutcome = {
  status: 'ticket_ok' | 'retry' | 'error' | 'unknown' | 'skipped';
  ticket?: string;
  code?: string;
  message?: string;
};
export type PushMessage = {
  to: string; title: string; body: string; data: Record<string, unknown>;
  channelId: string; badge: number; sound?: 'default' | null;
};

export async function sendPushBatch(messages: PushMessage[], send = fetch): Promise<PushOutcome[]> {
  if (messages.length === 0) return [];
  if (messages.length > 100) throw new Error('Expo batch exceeds 100');
  const all = (outcome: PushOutcome) => messages.map(() => ({ ...outcome }));
  let response: Response;
  try {
    response = await send('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    // 서버가 이미 수락했을 수 있으므로 타임아웃/연결 종료를 무조건 재시도하지 않는다.
    return all({ status: 'unknown', code: 'TransportUncertain' });
  }
  if (response.status === 429 || response.status >= 500) {
    return all({ status: 'retry', code: `HTTP_${response.status}` });
  }
  if (!response.ok) return all({ status: 'error', code: `HTTP_${response.status}` });
  let body: { data?: { status?: string; id?: string; message?: string; details?: { error?: string } }[] };
  try {
    body = await response.json();
  } catch {
    return all({ status: 'unknown', code: 'InvalidResponse' });
  }
  if (!Array.isArray(body?.data) || body.data.length !== messages.length) {
    return all({ status: 'unknown', code: 'InvalidResponse' });
  }
  return body.data.map((ticket) => {
    if (ticket?.status === 'ok' && typeof ticket.id === 'string' && ticket.id) {
      return { status: 'ticket_ok', ticket: ticket.id };
    }
    if (ticket?.status !== 'error') return { status: 'unknown', code: 'InvalidTicket' };
    const code = ticket.details?.error ?? 'UnknownTicketError';
    return { status: code === 'MessageRateExceeded' ? 'retry' : 'error', code, message: ticket.message };
  });
}
