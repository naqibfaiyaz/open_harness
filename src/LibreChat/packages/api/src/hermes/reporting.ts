import { createHmac } from 'node:crypto';

export interface ReportingPeriod {
  phrase: string;
  startDate: string;
  endDateExclusive: string;
  startUTC: string;
  endUTCExclusive: string;
}

/** Calendar arithmetic is performed in the configured zone, never the host's zone. */
function localDate(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function midnight(date: string, timeZone: string): string {
  const desired = Date.parse(`${date}T00:00:00Z`);
  let instant = desired;
  for (let i = 0; i < 5; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(instant));
    const p = (name: string) => Number(parts.find((value) => value.type === name)!.value);
    const wall = Date.UTC(p('year'), p('month') - 1, p('day'), p('hour'), p('minute'), p('second'));
    if (wall === desired) return new Date(instant).toISOString();
    instant += desired - wall;
  }
  throw new Error('HERMES_REPORTING_MIDNIGHT_UNRESOLVED');
}

export function reportingContext(text: string, timeZone: string, now = new Date()) {
  const today = localDate(now, timeZone);
  const [year, month, day] = today.split('-').map(Number);
  const date = (y: number, m: number, d: number) =>
    new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  const phrases = [
    ...new Set(
      text
        .toLowerCase()
        .match(/\b(?:last|this) (?:month|week|quarter|year)\b|\byesterday\b|\btoday\b/g) ?? [],
    ),
  ];
  let period: ReportingPeriod | undefined;
  if (phrases.length === 1) {
    const phrase = phrases[0];
    let start: string;
    let end: string;
    if (phrase.includes('month')) {
      const offset = phrase.startsWith('last') ? -1 : 0;
      start = date(year, month - 1 + offset, 1);
      end = date(year, month + offset, 1);
    } else if (phrase.includes('quarter')) {
      const quarter = Math.floor((month - 1) / 3) * 3 - (phrase.startsWith('last') ? 3 : 0);
      start = date(year, quarter, 1);
      end = date(year, quarter + 3, 1);
    } else if (phrase.includes('year')) {
      const offset = phrase.startsWith('last') ? -1 : 0;
      start = date(year + offset, 0, 1);
      end = date(year + offset + 1, 0, 1);
    } else if (phrase.includes('week')) {
      const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
      const monday = day - ((weekday + 6) % 7) - (phrase.startsWith('last') ? 7 : 0);
      start = date(year, month - 1, monday);
      end = date(year, month - 1, monday + 7);
    } else {
      const offset = phrase === 'yesterday' ? -1 : 0;
      start = date(year, month - 1, day + offset);
      end = date(year, month - 1, day + offset + 1);
    }
    period = {
      phrase,
      startDate: start,
      endDateExclusive: end,
      startUTC: midnight(start, timeZone),
      endUTCExclusive: midnight(end, timeZone),
    };
  }
  let status = 'not_requested';
  if (period) status = 'resolved';
  if (phrases.length > 1) status = 'clarification_required';
  return {
    version: 1,
    asOf: now.toISOString(),
    timeZone,
    today,
    status,
    period,
  };
}

export function reportingInstructions(text: string, timeZone: string, secret: string, now?: Date) {
  const context = reportingContext(text, timeZone, now);
  const payload = Buffer.from(JSON.stringify(context)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`reporting-v1:${payload}`).digest('hex');
  return (
    `Trusted request clock and reporting context (overrides stale dates in history or memory):\n${JSON.stringify(context)}\n` +
    `Use the supplied timezone and calendar boundaries. Weeks start Monday. End bounds are exclusive. ` +
    `Date-only fields use local dates; timestamp fields use UTC bounds. This week/month/quarter/year may contain future days: do not invent future results. ` +
    `For multiple periods or unsupported/ambiguous date language, ask for exact dates before querying. ` +
    `For follow-up edits preserve the original report's explicitly stated period; never silently replace it with another month. ` +
    `Before reporting, validate query filters and returned timestamps against the requested period. If no records match, report no data; never substitute a different period. ` +
    `State the exact reporting dates and timezone in the answer and any newly generated dashboard. Route reporting queries through structured MCP tools, not shell HTTP/SQL. ` +
    `Do not claim a complete report if source pagination or date validation is incomplete.\n[OPEN_HARNESS_REPORTING:${payload}.${signature}]`
  );
}
