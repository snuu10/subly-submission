export const DASHBOARD_WIDGETS = [
  {
    id: 'insights',
    title: '인사이트',
    description: '지출 변화와 이번 주 결제 브리핑을 확인합니다.',
  },
  {
    id: 'briefing',
    title: '나우 로그',
    description: '이용 확인과 해지·종료 알림을 빠르게 처리합니다.',
  },
  {
    id: 'category',
    title: '카테고리',
    description: '카테고리별 월 환산 지출을 비교합니다.',
  },
  {
    id: 'spend',
    title: '월평균 구독 지출액',
    description: '월평균과 이번 달·다음 달 예상 지출을 확인합니다.',
  },
  {
    id: 'upcoming',
    title: '다가오는 결제',
    description: '7일 안에 결제될 구독을 확인합니다.',
  },
  {
    id: 'mix',
    title: '구독 구성',
    description: '카테고리와 활성 상태 비율을 차트로 봅니다.',
  },
  {
    id: 'subscriptions',
    title: '구독 목록',
    description: '등록한 구독을 바로 확인하고 관리합니다.',
  },
  {
    id: 'payment-instruments',
    title: '결제수단 목록',
    description: '등록한 은행과 카드를 확인합니다.',
  },
  {
    id: 'notifications',
    title: '알림',
    description: '헤더 벨 아이콘의 결제·해지 알림을 위젯으로 바로 확인합니다.',
  },
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGETS)[number]['id'];

export type DashboardWidgetPreferences = {
  orderIds: DashboardWidgetId[];
  hiddenIds: DashboardWidgetId[];
};

export const DEFAULT_DASHBOARD_WIDGET_ORDER: DashboardWidgetId[] = DASHBOARD_WIDGETS.map(
  (widget) => widget.id
);

export const DEFAULT_DASHBOARD_WIDGET_IDS: DashboardWidgetId[] = [
  'insights',
  'briefing',
  'category',
  'spend',
];

export const DELETABLE_DASHBOARD_WIDGET_IDS: DashboardWidgetId[] = [
  'upcoming',
  'mix',
  'subscriptions',
  'payment-instruments',
  'notifications',
];

export const DEFAULT_DASHBOARD_HIDDEN_IDS: DashboardWidgetId[] = [
  ...DELETABLE_DASHBOARD_WIDGET_IDS,
];

const DELETABLE_WIDGET_IDS = new Set<string>(DELETABLE_DASHBOARD_WIDGET_IDS);

const WIDGET_IDS = new Set<string>(DEFAULT_DASHBOARD_WIDGET_ORDER);

function uniqueKnownIds(value: unknown): DashboardWidgetId[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter(
        (id): id is DashboardWidgetId => typeof id === 'string' && WIDGET_IDS.has(id)
      )
    )
  );
}

export function normalizeDashboardWidgetPreferences(
  orderIds: unknown,
  hiddenIds: unknown
): DashboardWidgetPreferences {
  const knownOrder = uniqueKnownIds(orderIds);
  const missing = DEFAULT_DASHBOARD_WIDGET_ORDER.filter((id) => !knownOrder.includes(id));
  return {
    orderIds: [...knownOrder, ...missing],
    hiddenIds: (Array.isArray(hiddenIds)
      ? uniqueKnownIds(hiddenIds)
      : DEFAULT_DASHBOARD_HIDDEN_IDS
    ).filter((id) => DELETABLE_WIDGET_IDS.has(id)),
  };
}

export function isDeletableDashboardWidget(id: DashboardWidgetId): boolean {
  return DELETABLE_WIDGET_IDS.has(id);
}

export function visibleDashboardWidgetIds(
  preferences: DashboardWidgetPreferences
): DashboardWidgetId[] {
  const hidden = new Set(preferences.hiddenIds);
  return preferences.orderIds.filter((id) => !hidden.has(id));
}

/**
 * 숨긴 위젯은 기존 슬롯에 그대로 두고, 화면에 보이는 위젯들의 상대 순서만 바꾼다.
 * 다시 표시할 때 사용자가 숨기기 전 문맥으로 돌아오도록 하기 위함이다.
 */
export function mergeVisibleWidgetOrder(
  orderIds: DashboardWidgetId[],
  hiddenIds: DashboardWidgetId[],
  visibleIds: DashboardWidgetId[]
): DashboardWidgetId[] {
  const hidden = new Set(hiddenIds);
  let visibleIndex = 0;
  return orderIds.map((id) => {
    if (hidden.has(id)) return id;
    return visibleIds[visibleIndex++] ?? id;
  });
}
