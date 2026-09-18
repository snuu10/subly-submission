import { useEffect, useState } from 'react';

import { WidgetCard } from '@/components/WidgetCard';
import { fetchWeeklyDigest, type WeeklyDigest } from '@/lib/ai-briefings';
import { formatCurrency } from '@/lib/calc';
import type { SpendInsight } from '@/types';

type InsightsWidgetProps = {
  insights: SpendInsight[];
  refreshKey?: number;
  onAsk: (launch: { prompt: string; entrySource: string }) => void;
};

function shortPeriod(start: string, end: string): string {
  const [, startMonth, startDay] = start.split('-').map(Number);
  const [, endMonth, endDay] = end.split('-').map(Number);
  return startMonth === endMonth
    ? `${startMonth}월 ${startDay}일–${endDay}일`
    : `${startMonth}월 ${startDay}일–${endMonth}월 ${endDay}일`;
}

function comparison(digest: WeeklyDigest): string {
  if (digest.thisWeek === 0) return '이번 주 예정된 구독 결제가 없어요';
  if (digest.lastWeek === 0) return '이번 주 결제 예정이 새로 있어요';
  if (digest.delta === 0) return '지난주와 같은 금액이에요';
  return `지난주보다 ${formatCurrency(Math.abs(digest.delta))} ${digest.delta > 0 ? '많아요' : '적어요'}`;
}

function assistantPrompt(digest: WeeklyDigest): string {
  const services = digest.charges.map((item) => item.name).filter(Boolean);
  const serviceContext = services.length > 0 ? ` 관련 구독: ${services.join(', ')}.` : '';
  return `이번 주 결제 예정 금액 ${formatCurrency(digest.thisWeek)}이 어떤 구독으로 구성됐는지 구독별로 알려줘.${serviceContext}`;
}

export function InsightsWidget({ insights, refreshKey = 0, onAsk }: InsightsWidgetProps) {
  const [digest, setDigest] = useState<WeeklyDigest | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchWeeklyDigest().then((result) => {
      if (!cancelled) setDigest(result);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <WidgetCard title="인사이트">
      <div className="flex flex-col gap-3">
        {insights.length === 0 ? (
          <p className="text-sm text-muted">구독을 등록하면 비중과 최대 구독이 보여요.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {insights.map((item) => (
              <li
                key={item.kind}
                className="rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-text"
              >
                {item.label}
              </li>
            ))}
          </ul>
        )}
        {digest ? (
          <button
            type="button"
            onClick={() => onAsk({ prompt: assistantPrompt(digest), entrySource: 'weekly_digest' })}
            aria-label="이번 주 결제 예정 금액의 구성 구독을 AI 비서에게 물어보기"
            className="group rounded-2xl border border-primary/20 bg-[#F5F3FF] p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-extrabold text-primary">이번 주 결제 브리핑</p>
              <p className="text-[11px] font-semibold text-muted">
                {shortPeriod(digest.weekStart, digest.weekEnd)}
              </p>
            </div>
            <p className="mt-2 text-lg font-extrabold text-text">
              이번 주 {formatCurrency(digest.thisWeek)} 결제 예정
            </p>
            <p className="mt-1 text-sm font-semibold text-text">{comparison(digest)}</p>
            <p className="mt-1 text-xs leading-5 text-muted">{digest.reason}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-extrabold text-primary">
              어떤 구독 때문인지 AI에게 물어보기
              <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">→</span>
            </span>
          </button>
        ) : null}
      </div>
    </WidgetCard>
  );
}
