import { useEffect, useState, type ReactNode } from 'react';

import { BrandLockup } from '@/components/BrandLockup';

export type DashboardView =
  | 'dashboard'
  | 'paymentStatus'
  | 'list'
  | 'upcoming'
  | 'usageHistory'
  | 'categories'
  | 'banks'
  | 'cards'
  | 'settings'
  | 'announcements';

const STATUS_VIEWS: DashboardView[] = ['paymentStatus', 'upcoming', 'usageHistory'];
const MANAGE_VIEWS: DashboardView[] = ['list', 'categories'];

type AppSidebarProps = {
  open: boolean;
  view: DashboardView;
  onNavigate: (view: DashboardView) => void;
  onAdd: () => void;
  onAssistant: () => void;
  onCloseMobile: () => void;
};

export function AppSidebar({
  open,
  view,
  onNavigate,
  onAdd,
  onAssistant,
  onCloseMobile,
}: AppSidebarProps) {
  const [subscriptionOpen, setSubscriptionOpen] = useState(true);
  const [statusOpen, setStatusOpen] = useState(true);
  const [manageOpen, setManageOpen] = useState(true);
  const [assetsOpen, setAssetsOpen] = useState(true);
  const [paymentMethodsOpen, setPaymentMethodsOpen] = useState(true);

  useEffect(() => {
    if (STATUS_VIEWS.includes(view) || MANAGE_VIEWS.includes(view)) {
      setSubscriptionOpen(true);
    }
    if (STATUS_VIEWS.includes(view)) setStatusOpen(true);
    if (MANAGE_VIEWS.includes(view)) setManageOpen(true);
    if (view === 'banks' || view === 'cards') {
      setAssetsOpen(true);
      setPaymentMethodsOpen(true);
    }
  }, [view]);

  function go(next: DashboardView) {
    onNavigate(next);
    onCloseMobile();
  }

  return (
    <aside
      className={`h-full w-[240px] shrink-0 flex-col border-r border-border bg-surface ${
        open ? 'flex' : 'hidden'
      }`}
    >
      <div className="border-b border-border px-4 py-4">
        <BrandLockup />
        <h2 className="text-base font-extrabold text-text">탐색</h2>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
        <NavItem
          active={view === 'dashboard'}
          icon={<GridIcon />}
          label="대시보드"
          onClick={() => go('dashboard')}
        />

        <TreeToggle
          className="mt-2"
          icon={<CardIcon />}
          label="구독"
          open={subscriptionOpen}
          onToggle={() => setSubscriptionOpen((prev) => !prev)}
        />

        {subscriptionOpen ? (
          <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
            <TreeToggle
              icon={<ChartIcon />}
              label="현황"
              open={statusOpen}
              onToggle={() => setStatusOpen((prev) => !prev)}
            />
            {statusOpen ? (
              <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
                <NavItem
                  active={view === 'paymentStatus'}
                  icon={<ChartIcon />}
                  label="결제 현황"
                  onClick={() => go('paymentStatus')}
                />
                <NavItem
                  active={view === 'upcoming'}
                  icon={<CalendarIcon />}
                  label="결제 예정"
                  onClick={() => go('upcoming')}
                />
                <NavItem
                  active={view === 'usageHistory'}
                  icon={<HistoryIcon />}
                  label="사용 기록"
                  onClick={() => go('usageHistory')}
                />
              </div>
            ) : null}

            <TreeToggle
              icon={<ListIcon />}
              label="관리"
              open={manageOpen}
              onToggle={() => setManageOpen((prev) => !prev)}
            />
            {manageOpen ? (
              <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
                <NavItem
                  active={view === 'list'}
                  icon={<ListIcon />}
                  label="구독 목록"
                  onClick={() => go('list')}
                />
                <NavItem icon={<PlusIcon />} label="구독 추가" onClick={onAdd} />
                <NavItem
                  active={view === 'categories'}
                  icon={<TagIcon />}
                  label="카테고리"
                  onClick={() => go('categories')}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <TreeToggle
          className="mt-2"
          icon={<WalletIcon />}
          label="자산"
          open={assetsOpen}
          onToggle={() => setAssetsOpen((prev) => !prev)}
        />
        {assetsOpen ? (
          <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
            <TreeToggle
              icon={<CardIcon />}
              label="결제수단"
              open={paymentMethodsOpen}
              onToggle={() => setPaymentMethodsOpen((prev) => !prev)}
            />
            {paymentMethodsOpen ? (
              <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
                <NavItem
                  active={view === 'banks'}
                  icon={<BankIcon />}
                  label="은행"
                  onClick={() => go('banks')}
                />
                <NavItem
                  active={view === 'cards'}
                  icon={<CardIcon />}
                  label="카드"
                  onClick={() => go('cards')}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="mt-4 px-2 text-[11px] font-semibold tracking-wide text-muted">도구</p>
        <NavItem icon={<ChatIcon />} label="비서" onClick={onAssistant} />
        <NavItem
          active={view === 'settings'}
          icon={<GearIcon />}
          label="설정"
          onClick={() => go('settings')}
        />
      </nav>
    </aside>
  );
}

function TreeToggle({
  label,
  icon,
  open,
  onToggle,
  className = '',
}: {
  label: string;
  icon: ReactNode;
  open: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm font-semibold text-text hover:bg-background ${className}`}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <ChevronIcon open={open} />
    </button>
  );
}

type NavItemProps = {
  label: string;
  icon: ReactNode;
  active?: boolean;
  onClick: () => void;
};

function NavItem({ label, icon, active, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium ${
        active ? 'bg-primary text-white' : 'text-text hover:bg-background'
      }`}
    >
      <span className={active ? 'text-white' : 'text-muted'}>{icon}</span>
      {label}
    </button>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 6h12M8 12h12M8 18h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 18v-1.2A7 7 0 0 1 6.2 5.8 7 7 0 0 1 19 12a7 7 0 0 1-2.8 5.6H12l-7 2.4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 7h10M8 12h10M8 17h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M5 7h.01M5 12h.01M5 17h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 13.2 12.8 20a2 2 0 0 1-2.8 0L4 14V4h10l6 6.2v3Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" />
    </svg>
  );
}

function BankIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10h16M6 10v8M10 10v8M14 10v8M18 10v8M3 18h18M12 4 3 10h18L12 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 19h16M7 16v-5M12 16V8M17 16v-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function WalletIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="6" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="16.5" cy="14.5" r="1.1" fill="currentColor" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M19.4 13a7.7 7.7 0 0 0 .1-2l2-1.2-2-3.4-2.3.6a8 8 0 0 0-1.7-1L15 3.6h-6l-.5 2.4a8 8 0 0 0-1.7 1l-2.3-.6-2 3.4L4.5 11a7.7 7.7 0 0 0 .1 2l-2 1.2 2 3.4 2.3-.6a8 8 0 0 0 1.7 1l.5 2.4h6l.5-2.4a8 8 0 0 0 1.7-1l2.3.6 2-3.4-2-1.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={open ? 'rotate-180 text-muted' : 'text-muted'}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
