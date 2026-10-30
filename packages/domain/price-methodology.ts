export const priceMethodology = {
  version: 'pulserate-pilot-v1',
  currency: 'USD',
  window_days: 90,
  fresh_days: 30,
  minimum_samples: 5,
  minimum_fresh_samples: 3,
  maximum_relative_iqr: 1,
  estimator: 'Median with linearly interpolated quartiles; no automatic outlier deletion.',
  cohort:
    'Explicit finance-curated equivalent variant and exact grade; never category-wide pooling.',
  exclusions: [
    'not_final',
    'related_party',
    'not_reviewed',
    'excluded',
    'refund',
    'credit_consideration',
    'out_of_window',
    'future',
    'grade_changed',
    'eligibility_revoked',
  ],
  calibration: 'Synthetic pilot calibration only; market backtesting and approval outstanding.',
} as const;
export type PriceInput = {
  id: string;
  amount_cents: number;
  occurred_at: string;
  reason: string | null;
};
const day = 86400000;
export function summarizePrices(inputs: PriceInput[], asOf: string) {
  const now = Date.parse(asOf);
  const decisions = inputs.map((i) => ({
    ...i,
    reason:
      i.reason ||
      (Date.parse(i.occurred_at) > now
        ? 'future'
        : now - Date.parse(i.occurred_at) > priceMethodology.window_days * day
          ? 'out_of_window'
          : null),
  }));
  const included = decisions.filter((i) => !i.reason);
  const sorted = included.map((i) => i.amount_cents).sort((a, b) => a - b);
  const quantile = (q: number) => {
    const pos = (sorted.length - 1) * q,
      low = Math.floor(pos);
    return Math.round(sorted[low] + (sorted[Math.ceil(pos)] - sorted[low]) * (pos - low));
  };
  const fresh = included.filter(
    (i) => now - Date.parse(i.occurred_at) <= priceMethodology.fresh_days * day,
  ).length;
  const median = sorted.length ? quantile(0.5) : null;
  const low = sorted.length ? quantile(0.25) : null,
    high = sorted.length ? quantile(0.75) : null;
  const state =
    sorted.length < priceMethodology.minimum_samples
      ? 'insufficient_data'
      : fresh < priceMethodology.minimum_fresh_samples
        ? 'stale'
        : (high! - low!) / median! > priceMethodology.maximum_relative_iqr
          ? 'dispersed'
          : 'available';
  const exclusions: Record<string, number> = {};
  decisions.forEach((i) => {
    if (i.reason) exclusions[i.reason] = (exclusions[i.reason] || 0) + 1;
  });
  return {
    decisions,
    result: {
      state,
      sample_count: sorted.length,
      fresh_count: fresh,
      excluded_count: decisions.length - sorted.length,
      exclusions,
      median_cents: state === 'available' ? median : null,
      range_cents: state === 'available' ? [low, high] : null,
      confidence: state === 'available' ? 'provisional' : 'unavailable',
      currency: 'USD',
      as_of: asOf,
      methodology: priceMethodology.version,
    },
  };
}
