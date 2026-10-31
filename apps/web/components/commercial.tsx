'use client';
import { useI18n } from './i18n';
import { useState } from 'react';
import { useAction, useData, useSession, type Row } from './providers';
import { Loading, ErrorNotice } from './ui';

const label = (s: string) => s.replaceAll('_', ' ');
export function CommercialTerms({ snapshot }: { snapshot?: Row | null }) {
  const { t: tr } = useI18n();

  if (!snapshot)
    return (
      <p className="muted">
        {tr('Historical order: no versioned commercial terms were recorded.')}
      </p>
    );
  return (
    <details className="panel">
      <summary>
        {tr('Local pilot terms · version ')}
        {snapshot.version}
      </summary>
      <p>
        {tr('Minimum age: ')}
        {snapshot.minimum_age}
        {tr('+. Production launch is not approved.')}
      </p>
      {snapshot.credit_scope === 'disabled' && (
        <p>{tr('Credit redemption is paused for this quote.')}</p>
      )}
      <dl className="spec-list">
        {Object.entries(snapshot.terms || {}).map(([topic, value]) => (
          <div key={topic}>
            <dt>{label(topic)}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function CommercialOperations() {
  const { t: tr, date } = useI18n();

  const { data, error, isPending, refetch } = useData<Row>('/ops/commercial');
  const action = useAction();
  const [topic, setTopic] = useState('credit_redemption');
  const [control, setControl] = useState('record_review');
  const [statement, setStatement] = useState('');
  const [evidence, setEvidence] = useState('');
  if (isPending) return <Loading />;
  if (!data) return <ErrorNotice error={error} />;
  return (
    <section className="panel">
      <h2>{tr('Commercial decisions')}</h2>
      <p>
        {tr('Version ')}
        {data.policy.version}
        {tr(' · New pilot checkout')} {data.policy.new_sales_enabled ? tr('open') : tr('paused')}
        {tr(' · Credits')}{' '}
        {data.policy.credit_scope === 'disabled' ? tr('paused') : tr('PixUP-owned stock only')}
        {tr(' · Minimum age ')}
        {data.minimum_age}+
      </p>
      <p>
        {tr(
          'Independent finance review records local pilot decisions. Contracts, refund entitlements, taxation and jurisdiction launch approvals remain unresolved with the named owners. Narrative evidence does not change executable terms.',
        )}
      </p>
      <CommercialTerms snapshot={{ ...data.policy, minimum_age: data.minimum_age }} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{tr('Decision area')}</th>
              <th>{tr('Owners / planning references')}</th>
              <th>{tr('Local review')}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.owners).map(([key, owner]) => (
              <tr key={key}>
                <td>{label(key)}</td>
                <td>{String(owner)}</td>
                <td>
                  {data.policy.reviewed_decisions[key]
                    ? tr('Reviewed for pilot; production unresolved')
                    : tr('Awaiting review')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>{tr('Propose a pilot decision')}</summary>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const result = await action.run(
              '/ops/commercial/decisions',
              { topic, action: control, base_version: data.policy.version, statement, evidence },
              'Proposal submitted for independent review.',
            );
            if (result) {
              setStatement('');
              setEvidence('');
              await refetch();
            }
          }}
        >
          <label>
            {tr('Decision area')}
            <select
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value);
                setControl('record_review');
              }}
            >
              {Object.keys(data.owners).map((t) => (
                <option key={t} value={t}>
                  {label(t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {tr('Pilot action')}
            <select value={control} onChange={(e) => setControl(e.target.value)}>
              <option value="record_review">
                {tr('Record review; preserve executable terms')}
              </option>
              {topic === 'credit_redemption' && (
                <>
                  <option value="disable_credits">{tr('Pause credit redemption')}</option>
                  <option value="restore_pilot_credits">
                    {tr('Restore PixUP-owned pilot redemption')}
                  </option>
                </>
              )}
              {topic === 'jurisdiction_age' && (
                <>
                  <option value="pause_sales">{tr('Pause new pilot checkout')}</option>
                  <option value="resume_pilot_sales">{tr('Resume local pilot checkout')}</option>
                </>
              )}
            </select>
          </label>
          <label>
            {tr('Decision statement')}
            <textarea
              required
              minLength={20}
              maxLength={4000}
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
            />
          </label>
          <label>
            {tr('Evidence reference')}
            <textarea
              required
              minLength={10}
              maxLength={2000}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </label>
          <p>
            {tr(
              'Only the selected pilot action can change behavior. Proposals expire after seven days; a newer approved version requires a fresh proposal.',
            )}
          </p>
          <button className="button" disabled={action.busy}>
            {tr('Submit commercial proposal')}
          </button>
          <ErrorNotice error={action.error} />
        </form>
      </details>
      <h3>{tr('Decision history')}</h3>
      {data.decisions.length === 0 && (
        <p>
          {tr(
            'No proposals yet. Existing demo terms are preserved without inferring business approval.',
          )}
        </p>
      )}
      {data.decisions.map((d: Row) => (
        <CommercialDecision
          key={d.id}
          decision={d}
          current={data.policy.version}
          refresh={refetch}
        />
      ))}
      <details>
        <summary>{tr('Policy version history')}</summary>
        {data.versions.map((v: Row) => (
          <div key={v.version}>
            <p>
              {tr('Version ')}
              {v.version} · {date(v.created_at)}
            </p>
            <p>
              {tr('New checkout ')}
              {v.snapshot.new_sales_enabled ? tr('open') : tr('paused')}
              {tr(' · Credit scope')} {label(v.snapshot.credit_scope)}
            </p>
            <small>
              {tr('Reviewed decision references: ')}
              {JSON.stringify(v.snapshot.reviewed_decisions)}
            </small>
          </div>
        ))}
      </details>
    </section>
  );
}
function CommercialDecision({
  decision: d,
  current,
  refresh,
}: {
  decision: Row;
  current: number;
  refresh: () => Promise<unknown>;
}) {
  const { t: tr, date } = useI18n();

  const { user } = useSession();
  const action = useAction();
  const [note, setNote] = useState('');
  const stale = d.base_version !== current || Date.parse(d.expires_at) <= Date.now();
  const decide = async (decision: string) => {
    const result = await action.run(
      `/ops/commercial/decisions/${d.id}/review`,
      { decision, note },
      'Commercial review recorded.',
    );
    if (result) await refresh();
  };
  return (
    <article className="panel">
      <h4>
        {label(d.topic)} · {label(d.action)} · {d.state}
      </h4>
      <p>{d.statement}</p>
      <p>
        {tr('Evidence: ')}
        {d.evidence}
      </p>
      <small>
        {tr('Proposal ')}
        {d.id}
        {tr(' · Base version ')}
        {d.base_version}
        {tr(' · Requester ')}
        {d.requested_by}
        {tr(' · Expires')} {date(d.expires_at)}
      </small>
      {d.review_note && (
        <p>
          {tr('Reviewer ')}
          {d.decided_by}: {d.review_note}
          {d.resulting_version && ` · Resulting version ${d.resulting_version}`}
        </p>
      )}
      {d.state === 'pending' &&
        (d.requested_by === user?.id ? (
          <p>{tr('Another finance reviewer must decide this commercial proposal.')}</p>
        ) : (
          <>
            {stale && (
              <p>
                {tr('This proposal is stale or expired. Reject it and request a new proposal.')}
              </p>
            )}
            <label>
              {tr('Commercial review note')}
              <textarea
                minLength={10}
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button
              className="button"
              disabled={action.busy || stale || note.trim().length < 10}
              onClick={() => void decide('approve')}
            >
              {tr('Approve local pilot decision')}
            </button>{' '}
            <button
              className="button secondary"
              disabled={action.busy || note.trim().length < 10}
              onClick={() => void decide('reject')}
            >
              {tr('Reject proposal')}
            </button>
            <ErrorNotice error={action.error} />
          </>
        ))}
    </article>
  );
}
