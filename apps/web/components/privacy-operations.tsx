'use client';
import { useState } from 'react';
import { useAction, useData, type Row } from './providers';
import { ErrorNotice, Loading, Status } from './ui';
export function PrivacySettings() {
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
      <h2>Privacy and pilot eligibility</h2>
      <p>{data.policy.notice}</p>
      <p>
        Minimum pilot age: {data.policy.minimum_age}. Current terms: {data.policy.terms_version};
        privacy notice: {data.policy.privacy_version}.
      </p>
      <p role="status">
        {data.eligible
          ? 'Your current declaration permits new pilot transactions.'
          : data.profile?.restriction
            ? 'New commercial activity is restricted. Existing orders, refunds and support remain available.'
            : 'Review the pilot notice and declaration before buying, listing or publishing.'}
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
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />I
            am at least {data.policy.minimum_age} years old.
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              required
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
            />
            I have reviewed and accept the local pilot terms and privacy notice above.
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={marketing}
              onChange={(e) => setMarketing(e.target.checked)}
            />
            Optional marketing consent (off by default).
          </label>
          <p>
            Submitting without the age declaration restricts new commercial activity until support
            reviews your account. No birth date or identity document is collected here.
          </p>
          <button className="button" disabled={action.busy || !agree}>
            Save pilot declaration
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
          Opt out of marketing
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
          Download account data
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
        <h3>Request privacy support</h3>
        <label>
          Request type
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="restrict">Restrict new commercial activity</option>
            <option value="delete">Request account closure</option>
            <option value="age_review">Review age restriction or restore access</option>
          </select>
        </label>
        <label>
          Request details (no identity documents)
          <textarea
            required
            minLength={10}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <p>
          Restriction and closure requests stop new transactions immediately. Closure may require
          retention review when orders, custody or shared business records exist. Financial and
          audit records are not automatically erased.
        </p>
        <button className="button secondary" disabled={action.busy}>
          Submit privacy request
        </button>
      </form>
      {data.requests.map((r: Row) => (
        <div className="notice" key={r.id}>
          <strong>{r.kind.replaceAll('_', ' ')} · </strong>
          <Status status={r.status} />
          <p>{r.decision_note || 'Awaiting support review.'}</p>
          <small>Internal review target: {new Date(r.due_at).toLocaleDateString()}</small>
        </div>
      ))}
    </section>
  );
}
export function PrivacyQueue() {
  const { data, error, isPending } = useData<Row[]>('/ops/privacy');
  const action = useAction();
  if (isPending) return <Loading />;
  return (
    <section>
      <h2>Privacy request queue</h2>
      <ErrorNotice error={error || action.error} />
      {data?.length === 0 && <p>No open requests.</p>}
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
          <p>Review by {new Date(r.due_at).toLocaleString()}</p>
          <label>
            Decision
            <select name="action">
              <option value="complete">Complete request</option>
              <option value="restore_access">Restore access after review</option>
              <option value="reject">Reject with explanation</option>
            </select>
          </label>
          <label>
            User-facing explanation
            <textarea name="note" required minLength={10} maxLength={2000} />
          </label>
          <p>
            Account closure is permitted only for accounts without business or custody history. A
            restore-access decision requires a fresh user declaration.
          </p>
          <button className="button" disabled={action.busy}>
            Record privacy decision
          </button>
        </form>
      ))}
    </section>
  );
}
export function MonitoringPanel() {
  const { data, error, isPending, refetch } = useData<Row>('/ops/monitoring');
  const action = useAction();
  if (isPending) return <Loading />;
  return (
    <section>
      <h2>Operational health</h2>
      <ErrorNotice error={error || action.error} />
      {data && (
        <>
          <p>
            Database: {data.readiness.database} · Worker: {data.readiness.worker} · Dropped
            telemetry: {data.dropped_events}
          </p>
          <button className="button secondary" onClick={() => void refetch()}>
            Refresh health
          </button>
          <h3>Alerts</h3>
          {!data.alerts.length && <p>No alerts have been recorded.</p>}
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
                {a.severity} · <Status status={a.status} /> · Last observed{' '}
                {new Date(a.last_seen).toLocaleString()}
              </p>
              {a.acknowledged_by && (
                <p>
                  Acknowledged by {a.acknowledged_by}: {a.acknowledgement}
                </p>
              )}
              {a.status === 'active' && (
                <>
                  <label>
                    Incident reference and next action
                    <textarea name="note" required minLength={10} />
                  </label>
                  <button className="button secondary" disabled={action.busy}>
                    Acknowledge alert
                  </button>
                </>
              )}
            </form>
          ))}
          <h3>Recent security and error events</h3>
          <p>Request bodies, tokens, addresses, raw URLs and provider payloads are excluded.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Route</th>
                  <th>Status</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e: Row) => (
                  <tr key={e.id}>
                    <td>{new Date(e.created_at).toLocaleTimeString()}</td>
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
