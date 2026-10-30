export const attributionMethodology = {
  version: 'ifci-observations-pilot-v1',
  lane: 'simulation',
  unit: 'completed transaction count',
  basis:
    'Current paid/fulfilled, unrelated-party trades without pending or successful refunds. Reversed trades remain visible but do not qualify.',
  source:
    'Collection issuing organization; source registration does not establish a beneficiary contract.',
  allocation:
    'No score weighting, 50/50 split, royalty, reserve deduction or payable is configured.',
  agency: 'Agency circulation is recorded but is excluded from prospective IFCI distribution.',
  payments_enabled: false,
};
export function attributeSales(sales: Record<string, any>[]) {
  const groups = new Map<string, Record<string, any>>();
  for (const s of sales) {
    const key = s.collection_id;
    const g = groups.get(key) || {
      collection_id: key,
      title: s.collection_title,
      issuance_mode: s.issuance_mode,
      observed: 0,
      qualifying: 0,
      excluded: 0,
      payment_eligible: false,
      payable_cents: null,
      payment_state:
        s.issuance_mode === 'agency' ? 'agency_excluded' : 'contract_and_policy_required',
    };
    g.observed++;
    if (['paid', 'fulfilled'].includes(s.status) && !s.refund && !s.related_party) g.qualifying++;
    else g.excluded++;
    groups.set(key, g);
  }
  return {
    methodology: attributionMethodology,
    as_of: new Date().toISOString(),
    collections: [...groups.values()],
  };
}
