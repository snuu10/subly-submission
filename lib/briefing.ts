const KST = 'Asia/Seoul';

export function kstISODate(from = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: KST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(from);
}

export function kstWeekdayMon0(from = new Date()): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: KST, weekday: 'short' }).format(from);
  const map: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return map[wd] ?? 0;
}

export function isKstMonday(from = new Date()): boolean {
  return kstWeekdayMon0(from) === 0;
}

export function addDaysISO(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function weekStartKst(from = new Date()): string {
  return addDaysISO(kstISODate(from), -kstWeekdayMon0(from));
}

export function weekEndKst(from = new Date()): string {
  return addDaysISO(weekStartKst(from), 6);
}
