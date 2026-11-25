import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
const requireLC = createRequire(new URL('../src/LibreChat/package.json', import.meta.url));
const { reportingContext, reportingInstructions } = requireLC('./packages/api/src/hermes/reporting.ts');

test('last month uses the previous Toronto calendar month, not model history or 30 days', () => {
  const context = reportingContext('Show last month sales', 'America/Toronto', new Date('2026-11-25T10:00:00Z'));
  assert.deepEqual(context.period, { phrase: 'last month', startDate: '2026-10-01', endDateExclusive: '2026-11-01', startUTC: '2026-10-01T04:00:00.000Z', endUTCExclusive: '2026-11-01T04:00:00.000Z' });
});
test('year rollover, leap year and spring DST are calendar aware', () => {
  assert.equal(reportingContext('last month', 'UTC', new Date('2027-01-01')).period?.startDate, '2026-12-01');
  const leap = reportingContext('last month', 'UTC', new Date('2024-03-01'));
  assert.equal(leap.period?.endDateExclusive, '2024-03-01');
  const dst = reportingContext('last month', 'America/Toronto', new Date('2026-04-15'));
  assert.equal(dst.period?.startUTC, '2026-03-01T05:00:00.000Z');
  assert.equal(dst.period?.endUTCExclusive, '2026-04-01T04:00:00.000Z');
});
test('request date is local, weeks start Monday, and fall DST days are 25 hours', () => {
  assert.equal(reportingContext('today', 'America/Toronto', new Date('2026-11-25T02:00:00Z')).today, '2026-11-24');
  const week = reportingContext('last week', 'UTC', new Date('2026-11-25'));
  assert.equal(week.period?.startDate, '2026-11-16');
  assert.equal(week.period?.endDateExclusive, '2026-11-23');
  const day = reportingContext('yesterday', 'America/Toronto', new Date('2026-11-02T15:00:00Z')).period!;
  assert.equal(Date.parse(day.endUTCExclusive) - Date.parse(day.startUTC), 25 * 3600000);
});
test('multiple periods require clarification; no temporal request invents no range', () => {
  assert.equal(reportingContext('last month versus this month', 'UTC').status, 'clarification_required');
  assert.equal(reportingContext('hello', 'UTC').status, 'not_requested');
  assert.throws(() => reportingContext('today', 'Toronto/not-real'));
  assert.match(reportingInstructions('last month', 'UTC', 'fixture-key'), /OPEN_HARNESS_REPORTING:/);
});
