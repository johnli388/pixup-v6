import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { priceMethodology, summarizePrices } from '../packages/domain/price-methodology';
// Fixed, deterministic synthetic holdout scenarios: never sourced from live observations.
const asOf = '2026-10-30T12:00:00.000Z';
const scenarios = [
  {
    name: 'stable comparable cohort',
    values: [9800, 9900, 10000, 10100, 10200],
    days: 0,
    state: 'available',
    expected: 10000,
  },
  {
    name: 'one extreme contaminant',
    values: [9800, 9900, 10000, 10100, 1000000],
    days: 0,
    state: 'available',
    expected: 10000,
  },
  {
    name: 'insufficient sample',
    values: [9900, 10000, 10100, 10200],
    days: 0,
    state: 'insufficient_data',
    expected: null,
  },
  {
    name: 'stale cohort',
    values: [9800, 9900, 10000, 10100, 10200],
    days: 31,
    state: 'stale',
    expected: null,
  },
  {
    name: 'incompatible dispersion',
    values: [100, 200, 300, 10000, 100000],
    days: 0,
    state: 'dispersed',
    expected: null,
  },
  {
    name: 'outside observation window',
    values: [9800, 9900, 10000, 10100, 10200],
    days: 91,
    state: 'insufficient_data',
    expected: null,
  },
];
const results = scenarios.map((s) => {
  const { result } = summarizePrices(
    s.values.map((amount_cents, i) => ({
      id: String(i),
      amount_cents,
      occurred_at: new Date(Date.parse(asOf) - s.days * 86400000).toISOString(),
      reason: null,
    })),
    asOf,
  );
  assert.equal(result.state, s.state, s.name);
  assert.equal(result.median_cents, s.expected, s.name);
  return {
    scenario: s.name,
    state: result.state,
    reference_cents: result.median_cents,
    expected_cents: s.expected,
    absolute_error_cents: s.expected === null ? null : Math.abs(result.median_cents! - s.expected),
  };
});
const report = {
  methodology: priceMethodology,
  scope:
    'Deterministic synthetic robustness/sufficiency calibration. No market accuracy or statistical coverage claim.',
  scenarios: results,
  passed: true,
};
if (process.env.PIXUP_CALIBRATION_REPORT)
  await writeFile(process.env.PIXUP_CALIBRATION_REPORT, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
