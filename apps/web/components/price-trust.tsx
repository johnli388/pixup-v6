'use client';
import { useI18n } from './i18n';
import { useState } from 'react';
import { useAction, useData, type Row } from './providers';
import { ErrorNotice, Loading } from './ui';
export function PriceReference({ data }: { data: Row }) {
  const { t: tr, money, date } = useI18n();

  return (
    <section aria-label={tr('Price methodology')}>
      <h3>{tr('Comparable price reference')}</h3>
      <p>{data?.cohort?.label || tr('Comparable cohort not configured.')}</p>
      <p>
        {data?.cohort?.definition ||
          tr(
            'Finance must identify equivalent variants and matching condition before publishing a reference.',
          )}
      </p>
      {data?.lanes?.map((l: Row) => (
        <div className="notice" key={l.lane}>
          <strong>
            {l.lane === 'simulation' ? tr('Simulation trades') : tr('Reviewed external sales')} ·{' '}
            {l.state.replaceAll('_', ' ')}
          </strong>
          {l.median_cents != null && (
            <p>
              {tr('Median ')}
              {money(l.median_cents)}
              {tr(' · middle 50% ')}
              {money(l.range_cents[0])}–{money(l.range_cents[1])}
            </p>
          )}
          {l.sample_count != null && (
            <p>
              {l.sample_count}
              {tr(' included · ')}
              {l.excluded_count}
              {tr(' excluded · ')}
              {l.fresh_count}
              {tr(' within 30 days. As of ')}
              {date(l.as_of)}.
            </p>
          )}
          {l.exclusions && Object.keys(l.exclusions).length > 0 && (
            <p>
              {tr('Exclusions:')}{' '}
              {Object.entries(l.exclusions)
                .map(([k, v]) => `${k.replaceAll('_', ' ')}: ${v}`)
                .join('; ')}
              .
            </p>
          )}
        </div>
      ))}
      <details>
        <summary>{tr('Methodology and limitations')}</summary>
        <p>
          {data?.methodology?.version}
          {tr(
            ': median and interquartile range within 90 days; at least five samples, including three within 30 days. Excess dispersion withholds a reference. Published inputs are rechecked for reversals and review changes.',
          )}
        </p>
        <p>
          {tr(
            'Synthetic pilot calibration only. Simulation and external sales are separate. A reference is not an appraisal, guaranteed exit price or money owed.',
          )}
        </p>
      </details>
    </section>
  );
}
export function AttributionReport({ data }: { data: Row }) {
  const { t: tr, date } = useI18n();

  if (!data) return null;
  return (
    <section className="panel" aria-label={tr('Creator attribution')}>
      <h2>{tr('Creator attribution')}</h2>
      <p>
        {data.methodology.version}
        {tr(' · Simulation observations · ')}
        {date(data.as_of)}
      </p>
      <p>{data.methodology.basis}</p>
      {data.collections.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{tr('Collection')}</th>
                <th>{tr('Qualifying / recorded')}</th>
                <th>{tr('Payment status')}</th>
              </tr>
            </thead>
            <tbody>
              {data.collections.map((c: Row) => (
                <tr key={c.collection_id}>
                  <td>{c.title}</td>
                  <td>
                    {c.qualifying} / {c.observed}
                  </td>
                  <td>{c.payment_state.replaceAll('_', ' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>{tr('No circulation observations yet.')}</p>
      )}
      <details>
        <summary>{tr('Attribution methodology')}</summary>
        <p>{data.methodology.source}</p>
        <p>{data.methodology.agency}</p>
        <p>{data.methodology.allocation}</p>
      </details>
    </section>
  );
}
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function TrustOperations() {
  const { t: tr, date } = useI18n();

  const { data, error, isPending } = useData<Row>('/ops/trust'),
    action = useAction();
  const [kind, setKind] = useState('certificate'),
    [resource, setResource] = useState(''),
    [artifact, setArtifact] = useState(''),
    [parseError, setParseError] = useState('');
  if (isPending) return <Loading />;
  if (!data) return <ErrorNotice error={error} />;
  return (
    <section className="panel">
      <h2>{tr('Certificate signatures and checkpoints')}</h2>
      <p>{data.boundary}</p>
      {!data.keys.length && (
        <p className="notice warning">
          {tr(
            'Trust store not configured. Requests can be exported; signatures cannot be accepted until an independent operator provisions public keys.',
          )}
        </p>
      )}
      <ErrorNotice error={action.error} />
      <form
        className="channel-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await action.run('/ops/trust/requests', { kind, resource_id: resource });
          if (r) download(r, `pixup-${kind}-request.json`);
        }}
      >
        <label>
          {tr('Signing request type')}
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="certificate">{tr('Certificate assessment')}</option>
            <option value="checkpoint">{tr('Provenance checkpoint')}</option>
          </select>
        </label>
        {kind === 'certificate' && (
          <label>
            {tr('Certificate ID')}
            <input required value={resource} onChange={(e) => setResource(e.target.value)} />
          </label>
        )}
        <button className="button" disabled={action.busy}>
          {tr('Download signing request')}
        </button>
      </form>
      <p>
        {tr(
          'Have the separate key custodian inspect and sign the request offline. Assessment reviewers cannot request or import signatures for their own assessments. Keep checkpoint requests and roots in independently controlled storage.',
        )}
      </p>
      <form
        className="channel-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setParseError('');
          let d;
          try {
            d = JSON.parse(artifact);
          } catch {
            setParseError('Enter the signature artifact as valid JSON.');
            return;
          }
          await action.run('/ops/trust/signatures', d, 'Signature verified and recorded.');
        }}
      >
        <label>
          {tr('Signed artifact JSON (never a private key)')}
          <textarea required value={artifact} onChange={(e) => setArtifact(e.target.value)} />
        </label>
        {parseError && <p role="alert">{parseError}</p>}
        <button className="button secondary" disabled={action.busy}>
          {tr('Verify and import signature')}
        </button>
      </form>
      <h3>{tr('Configured verification keys')}</h3>
      {data.keys.map((k: Row) => (
        <p key={k.id}>
          {k.id} · {k.purpose} · {k.revoked ? tr('revoked') : tr('configured')}
          {tr(' · expires')} {date(k.not_after)}
        </p>
      ))}
      <h3>{tr('Recent signed records')}</h3>
      {data.signatures.length ? (
        data.signatures.map((s: Row) => (
          <p key={s.id}>
            {s.key_id}
            {tr(' · request ')}
            {s.request_id} · {date(s.created_at)}
          </p>
        ))
      ) : (
        <p>{tr('No signed records yet.')}</p>
      )}
    </section>
  );
}
export function PricingOperations() {
  const { t: tr, money, date } = useI18n();

  const { data, error, isPending } = useData<Row>('/ops/pricing'),
    action = useAction();
  const [selected, setSelected] = useState('');
  if (isPending) return <Loading />;
  if (!data) return <ErrorNotice error={error} />;
  const cid = selected || data.cohorts[0]?.id || '';
  return (
    <section className="panel">
      <h2>{tr('Price observations')}</h2>
      <p>{data.methodology.calibration}</p>
      <ErrorNotice error={action.error} />
      <details>
        <summary>{tr('Create a comparable cohort')}</summary>
        <form
          className="channel-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const r = await action.run(
              '/ops/pricing/cohorts',
              {
                label: f.get('label'),
                definition: f.get('definition'),
                grade: f.get('grade'),
                asset_ids: String(f.get('assets'))
                  .split(',')
                  .map((x) => x.trim())
                  .filter(Boolean),
              },
              'Comparable cohort recorded.',
            );
            if (r) setSelected(r.id);
          }}
        >
          <label>
            {tr('Cohort label')}
            <input name="label" required minLength={3} maxLength={100} />
          </label>
          <label>
            {tr('Comparable definition (variant, edition, language and condition)')}
            <textarea name="definition" required minLength={20} maxLength={2000} />
          </label>
          <label>
            {tr('Exact grade')}
            <input name="grade" required maxLength={50} />
          </label>
          <label>
            {tr('Specimen IDs (comma separated)')}
            <input name="assets" required />
          </label>
          <p>
            {tr(
              'Assignments are immutable. Verify equivalence before submitting; do not combine an entire category or unrelated variants.',
            )}
          </p>
          <button className="button" disabled={action.busy}>
            {tr('Create cohort')}
          </button>
        </form>
      </details>
      <label>
        {tr('Comparable cohort')}
        <select value={cid} onChange={(e) => setSelected(e.target.value)}>
          <option value="" disabled>
            {tr('Select a cohort')}
          </option>
          {data.cohorts.map((c: Row) => (
            <option value={c.id} key={c.id}>
              {c.label} · {c.grade}
            </option>
          ))}
        </select>
      </label>
      {cid && (
        <>
          <div className="button-row">
            {['simulation', 'external'].map((lane) => (
              <button
                key={lane}
                className="button secondary"
                disabled={action.busy}
                onClick={() =>
                  void action.run(
                    `/ops/pricing/cohorts/${cid}/snapshots`,
                    { lane },
                    'Price snapshot recorded.',
                  )
                }
              >
                {tr('Refresh ')}
                {lane}
                {tr(' snapshot')}
              </button>
            ))}
          </div>
          <details>
            <summary>{tr('Record an external completed sale')}</summary>
            <form
              className="channel-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await action.run(
                  '/ops/pricing/observations',
                  {
                    cohort_id: cid,
                    source: f.get('source'),
                    source_reference: f.get('reference'),
                    permission_evidence: f.get('permission'),
                    evidence: f.get('evidence'),
                    amount_cents: Math.round(Number(f.get('amount')) * 100),
                    occurred_at: new Date(String(f.get('time'))).toISOString(),
                    final_sale: f.has('final'),
                    related_party: f.has('related'),
                  },
                  'Observation submitted for independent finance review.',
                );
              }}
            >
              <label>
                {tr('Source name')}
                <input name="source" required minLength={3} maxLength={100} />
              </label>
              <label>
                {tr('Unique source sale reference')}
                <input name="reference" required maxLength={200} />
              </label>
              <label>
                {tr('Source permission evidence')}
                <textarea name="permission" required minLength={10} maxLength={2000} />
              </label>
              <label>
                {tr('Final sale and comparability evidence')}
                <textarea name="evidence" required minLength={10} maxLength={2000} />
              </label>
              <label>
                {tr('Item price USD (exclude shipping and tax)')}
                <input name="amount" type="number" required min="0.01" max="1000000" step="0.01" />
              </label>
              <label>
                {tr('Completed at')}
                <input name="time" type="datetime-local" required />
              </label>
              <label>
                <input type="checkbox" name="final" />
                {tr('Final completed sale confirmed')}
              </label>
              <label>
                <input type="checkbox" name="related" />
                {tr('Related-party or self-dealing sale')}
              </label>
              <button className="button" disabled={action.busy}>
                {tr('Submit observation')}
              </button>
            </form>
          </details>
        </>
      )}
      <h3>{tr('Observation review')}</h3>
      {data.observations
        .filter((o: Row) => o.cohort_id === cid)
        .map((o: Row) => (
          <details key={o.id}>
            <summary>
              {o.lane} · {o.source} · {money(o.amount_cents)} ·{' '}
              {o.decision || tr('awaiting review')}
            </summary>
            <p>{o.permission_evidence}</p>
            <p>{o.evidence}</p>
            <form
              className="channel-form"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await action.run(
                  `/ops/pricing/observations/${o.id}/review`,
                  { decision: f.get('decision'), reason: f.get('reason') },
                  'Review recorded; refresh snapshots to publish corrections.',
                );
              }}
            >
              <label>
                {tr('Observation decision')}
                <select name="decision">
                  <option value="exclude">{tr('Exclude or reverse')}</option>
                  <option value="include">{tr('Include verified evidence')}</option>
                </select>
              </label>
              <label>
                {tr('Review reason')}
                <input name="reason" required minLength={10} maxLength={2000} />
              </label>
              <button className="button secondary" disabled={action.busy}>
                {tr('Record independent review')}
              </button>
            </form>
          </details>
        ))}
      <h3>{tr('Recent snapshots')}</h3>
      {data.snapshots
        .filter((s: Row) => s.cohort_id === cid)
        .map((s: Row) => (
          <p key={s.id}>
            {s.lane} · {s.result.state.replaceAll('_', ' ')} · {s.result.sample_count}
            {tr(' samples ·')} {date(s.as_of)}
          </p>
        ))}
      <p className="notice">
        {tr(
          'Governance and reserves: policy not configured. No reserve deductions, 6Re actions, IFCI payments or VACV valuation are activated.',
        )}
      </p>
    </section>
  );
}
