'use client';
import { useI18n } from './i18n';
import { useState } from 'react';
import { useAction, useData, type Row } from './providers';
import { ErrorNotice, Loading, Status } from './ui';
export function PrivacySettings() {
  const { t: tr, dateTime } = useI18n();

  const { data, error, isPending } = useData<Row>('/privacy');
  const action = useAction();
  const [adult, setAdult] = useState(false),
    [agree, setAgree] = useState(false),
    [marketing, setMarketing] = useState(false),
    [kind, setKind] = useState('restrict'),
    [note, setNote] = useState('');
  if (isPending) return <Loading />;
  if (!data) return <ErrorNotice error={error} />;
  return (
    <section className="panel">
      <h2>{tr('Privacy and pilot eligibility')}</h2>
      <p>{data.policy.notice}</p>
      <p>
        {tr('Minimum pilot age: ')}
        {data.policy.minimum_age}
        {tr('. Current terms: ')}
        {data.policy.terms_version}
        {tr('; privacy notice: ')}
        {data.policy.privacy_version}.
      </p>
      <p role="status">
        {data.eligible
          ? tr('Your current declaration permits new pilot transactions.')
          : data.profile?.restriction
            ? tr(
                'New commercial activity is restricted. Existing orders, refunds and support remain available.',
              )
            : tr('Review the pilot notice and declaration before buying, listing or publishing.')}
      </p>
      <ErrorNotice error={action.error} />
      {!data.profile?.restriction && (
        <form
          className="channel-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (agree)
              await action.run(
                '/privacy/consent',
                {
                  adult,
                  terms_version: data.policy.terms_version,
                  privacy_version: data.policy.privacy_version,
                  marketing_opt_in: marketing,
                },
                'Declaration recorded.',
              );
          }}
        >
          <label className="check-row">
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
            {tr('I am at least ')}
            {data.policy.minimum_age}
            {tr(' years old.')}
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              required
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            {tr('I have reviewed and accept the local pilot terms and privacy notice above.')}
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={marketing}
              onChange={(e) => setMarketing(e.target.checked)}
            />
            {tr('Optional marketing consent (off by default).')}
          </label>
          <p>
            {tr(
              'Submitting without the age declaration restricts new commercial activity until support reviews your account. No birth date or identity document is collected here.',
            )}
          </p>
          <button className="button" disabled={action.busy || !agree}>
            {tr('Save pilot declaration')}
          </button>
        </form>
      )}
      <div className="button-row">
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={() =>
            void action.run(
              '/privacy/preferences',
              { marketing_opt_in: false },
              'Optional marketing consent withdrawn.',
            )
          }
        >
          {tr('Opt out of marketing')}
        </button>
        <button
          className="button secondary"
          disabled={action.busy}
          onClick={async () => {
            const data = await action.run('/privacy/export', {});
            if (data) {
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
                url = URL.createObjectURL(blob),
                a = document.createElement('a');
              a.href = url;
              a.download = 'pixup-account-data.json';
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
          }}
        >
          {tr('Download account data')}
        </button>
      </div>
      <form
        className="channel-form"
        onSubmit={async (e) => {
          e.preventDefault();
          await action.run(
            '/privacy/requests',
            { kind, note },
            'Request recorded for support review.',
          );
        }}
      >
        <h3>{tr('Request privacy support')}</h3>
        <label>
          {tr('Request type')}
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="restrict">{tr('Restrict new commercial activity')}</option>
            <option value="delete">{tr('Request account closure')}</option>
            <option value="age_review">{tr('Review age restriction or restore access')}</option>
          </select>
        </label>
        <label>
          {tr('Request details (no identity documents)')}
          <textarea
            required
            minLength={10}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <p>
          {tr(
            'Restriction and closure requests stop new transactions immediately. Closure may require retention review when orders, custody or shared business records exist. Financial and audit records are not automatically erased.',
          )}
        </p>
        <button className="button secondary" disabled={action.busy}>
          {tr('Submit privacy request')}
        </button>
      </form>
      {data.requests.map((r: Row) => (
        <div className="notice" key={r.id}>
          <strong>{r.kind.replaceAll('_', ' ')} · </strong>
          <Status status={r.status} />
          <p>{r.decision_note || tr('Awaiting support review.')}</p>
          <small>
            {tr('Internal review target: ')}
            {dateTime(r.due_at)}
          </small>
        </div>
      ))}
    </section>
  );
}
export function PrivacyQueue() {
  const { t: tr, dateTime } = useI18n();

  const { data, error, isPending } = useData<Row[]>('/ops/privacy');
  const action = useAction();
  if (isPending) return <Loading />;
  return (
    <section>
      <h2>{tr('Privacy request queue')}</h2>
      <ErrorNotice error={error || action.error} />
      {data?.length === 0 && <p>{tr('No open requests.')}</p>}
      {data?.map((r) => (
        <form
          className="panel channel-form"
          key={r.id}
          onSubmit={(e) => {
            e.preventDefault();
            const d = Object.fromEntries(new FormData(e.currentTarget));
            void action.run(`/ops/privacy/${r.id}`, d, 'Decision recorded.');
          }}
        >
          <h3>
            {r.kind.replaceAll('_', ' ')} · {r.user_id}
          </h3>
          <p>{r.note}</p>
          <p>
            {tr('Review by ')}
            {dateTime(r.due_at)}
          </p>
          <label>
            {tr('Decision')}
            <select name="action">
              <option value="complete">{tr('Complete request')}</option>
              <option value="restore_access">{tr('Restore access after review')}</option>
              <option value="reject">{tr('Reject with explanation')}</option>
            </select>
          </label>
          <label>
            {tr('User-facing explanation')}
            <textarea name="note" required minLength={10} maxLength={2000} />
          </label>
          <p>
            {tr(
              'Account closure is permitted only for accounts without business or custody history. A restore-access decision requires a fresh user declaration.',
            )}
          </p>
          <button className="button" disabled={action.busy}>
            {tr('Record privacy decision')}
          </button>
        </form>
      ))}
    </section>
  );
}
export function MonitoringPanel() {
  const { t: tr, dateTime } = useI18n();

  const { data, error, isPending, refetch } = useData<Row>('/ops/monitoring');
  const action = useAction();
  if (isPending) return <Loading />;
  return (
    <section>
      <h2>{tr('Operational health')}</h2>
      <ErrorNotice error={error || action.error} />
      {data && (
        <>
          <p>
            {tr('Database: ')}
            {data.readiness.database}
            {tr(' · Worker: ')}
            {data.readiness.worker}
            {tr(' · Dropped telemetry: ')}
            {data.dropped_events}
          </p>
          <button className="button secondary" onClick={() => void refetch()}>
            {tr('Refresh health')}
          </button>
          <h3>{tr('Alerts')}</h3>
          {!data.alerts.length && <p>{tr('No alerts have been recorded.')}</p>}
          {data.alerts.map((a: Row) => (
            <form
              className="panel channel-form"
              key={a.code}
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(
                  `/ops/monitoring/${a.code}/acknowledge`,
                  { note: new FormData(e.currentTarget).get('note') },
                  'Alert acknowledged. The condition remains monitored.',
                );
              }}
            >
              <h4>{a.summary}</h4>
              <p>
                {a.severity} · <Status status={a.status} />
                {tr(' · Last observed')} {dateTime(a.last_seen)}
              </p>
              {a.acknowledged_by && (
                <p>
                  {tr('Acknowledged by ')}
                  {a.acknowledged_by}: {a.acknowledgement}
                </p>
              )}
              {a.status === 'active' && (
                <>
                  <label>
                    {tr('Incident reference and next action')}
                    <textarea name="note" required minLength={10} />
                  </label>
                  <button className="button secondary" disabled={action.busy}>
                    {tr('Acknowledge alert')}
                  </button>
                </>
              )}
            </form>
          ))}
          <h3>{tr('Recent security and error events')}</h3>
          <p>
            {tr('Request bodies, tokens, addresses, raw URLs and provider payloads are excluded.')}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{tr('Time')}</th>
                  <th>{tr('Route')}</th>
                  <th>{tr('Status')}</th>
                  <th>{tr('Reference')}</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e: Row) => (
                  <tr key={e.id}>
                    <td>{dateTime(e.created_at)}</td>
                    <td>
                      {e.method} {e.route}
                    </td>
                    <td>{e.status}</td>
                    <td>{e.correlation_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
