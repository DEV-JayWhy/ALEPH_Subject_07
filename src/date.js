const zone = 'Asia/Seoul';
const dateParts = (date, options) => Object.fromEntries(
  new Intl.DateTimeFormat('en-US', { timeZone: zone, ...options })
    .formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, p.value])
);

export function seoulToday() {
  const p = dateParts(new Date(), { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

export function seoulDateTime(instant) {
  if (!instant) return '—';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(instant));
}

export function seoulInputNow() {
  const p = dateParts(new Date(), {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export function seoulInputToIso(value) {
  const date = new Date(`${value}:00+09:00`);
  if (!value || Number.isNaN(date.getTime())) throw new Error('시작·종료 시각을 확인해 주세요.');
  return date.toISOString();
}

export function dateLabel(date) { return date || '—'; }
