'use client';
import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAction, useData, useSession, type Row } from './providers';
import { ErrorNotice, Loading, date } from './ui';
export function IdentitySignIn() {
  const search = useSearchParams();
  const { data } = useData('/identity/config'),
    a = useAction();
  return (
    <div className="spaced">
      {search.get('password_reset') && (
        <p role="status">Password changed. Sign in again; enrolled MFA remains required.</p>
      )}
      {search.get('identity_error') && (
        <p role="alert">
          Managed sign-in could not be completed. Start again, or use your existing account sign-in.
          Matching emails are never linked automatically.
        </p>
      )}
      {data?.managed_enabled && (
        <button
          className="button secondary"
          disabled={a.busy}
          onClick={async () => {
            const r = await a.run('/identity/oidc/start', {});
            if (r) window.location.assign(r.url);
          }}
        >
          Continue with managed identity
        </button>
      )}
      {data?.mail_enabled && (
        <details>
          <summary>Forgot your password?</summary>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              await a.run(
                '/identity/reset-request',
                { email: d.get('email') },
                'If an eligible account exists, a recovery link will be sent.',
              );
            }}
          >
            <label className="field">
              Recovery email
              <input name="email" type="email" required maxLength={254} />
            </label>
            <button className="button secondary" disabled={a.busy}>
              Send password recovery link
            </button>
          </form>
        </details>
      )}
      <ErrorNotice error={a.error} />
    </div>
  );
}
export function SecuritySettings() {
  const { user, request, refresh } = useSession(),
    { data, error } = useData('/identity/status');
  const a = useAction();
  const [enrollment, setEnrollment] = useState<Row | null>(null),
    [codes, setCodes] = useState<string[]>([]),
    [localError, setLocalError] = useState('');
  if (!data)
    return (
      <>
        <Loading />
        <ErrorNotice error={error} />
      </>
    );
  return (
    <section className="panel settings-panel">
      <h1>Account security</h1>
      <p>
        Email: {data.email_verified ? 'verified' : 'not verified'}. Authenticator:{' '}
        {data.mfa_enabled ? 'enrolled' : 'not enrolled'}.
      </p>
      {data.mfa_required && (
        <p role="alert">
          Complete authenticator verification to continue. Staff policy may require first-time
          enrollment.
        </p>
      )}
      {!data.email_verified && data.mail_enabled && !data.mfa_required && (
        <button
          className="button secondary"
          disabled={a.busy}
          onClick={() => void a.run('/identity/verify-email', {}, 'Email verification requested.')}
        >
          Send email verification link
        </button>
      )}
      {!data.mfa_enabled && data.mfa_available && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            const r = await a.run('/identity/mfa/enroll', { password: d.get('password') || '' });
            if (r) setEnrollment(r);
          }}
        >
          <p>
            Add the setup key to an authenticator app, then enter its current six-digit code. Keep
            recovery codes offline.
          </p>
          {data.local_login_enabled && (
            <label className="field">
              Current password for enrollment
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                maxLength={128}
              />
            </label>
          )}
          <button className="button secondary" disabled={a.busy}>
            Start authenticator enrollment
          </button>
        </form>
      )}
      {data.mfa_enabled && !data.mfa_required && (
        <details className="spaced">
          <summary>Replace a lost or retired authenticator</summary>
          <p>
            First verify a current authenticator or unused recovery code, then confirm your
            password. Your existing factor stays active until the replacement is confirmed. New
            recovery codes replace all previous codes.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              const r = await a.run('/identity/mfa/replace', { password: d.get('password') || '' });
              if (r) setEnrollment(r);
            }}
          >
            {data.local_login_enabled && (
              <label className="field">
                Current password for replacement
                <input name="password" type="password" required maxLength={128} />
              </label>
            )}
            <button className="button secondary" disabled={a.busy}>
              Start authenticator replacement
            </button>
          </form>
        </details>
      )}
      {enrollment && (
        <div className="notice">
          <p>Authenticator setup key (shown only for this enrollment):</p>
          <code style={{ overflowWrap: 'anywhere' }}>{enrollment.secret}</code>
          <p>Use account {user?.email}, issuer PixUP, six digits, SHA-1, 30 seconds.</p>
        </div>
      )}
      {(data.mfa_enabled || enrollment) && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const d = new FormData(e.currentTarget);
            setLocalError('');
            try {
              const r = await request('/identity/mfa/verify', {
                code: String(d.get('code')).trim(),
                enrollment: !!enrollment,
              });
              setCodes(r.recovery_codes || []);
              setEnrollment(null);
              await refresh();
            } catch (err) {
              setLocalError((err as Error).message);
            }
          }}
        >
          <label className="field">
            Authenticator or recovery code
            <input name="code" autoComplete="one-time-code" required minLength={6} maxLength={24} />
          </label>
          <button className="button">Verify authenticator</button>
        </form>
      )}
      {!!codes.length && (
        <div className="notice" role="status">
          <strong>Save these recovery codes now. Each can be used once.</strong>
          <pre>{codes.join('\n')}</pre>
          <button className="button secondary" onClick={() => setCodes([])}>
            I saved my recovery codes
          </button>
        </div>
      )}
      {!data.mfa_required && (
        <>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              await a.run(
                '/identity/reauthenticate',
                { password: d.get('password') },
                'Password confirmed for sensitive changes.',
              );
            }}
          >
            {data.local_login_enabled ? (
              <>
                <label className="field">
                  Confirm password for sensitive changes
                  <input name="password" type="password" required maxLength={128} />
                </label>
                <button className="button secondary" disabled={a.busy}>
                  Confirm password
                </button>
              </>
            ) : (
              <p>Sign in again with your managed provider before a sensitive change.</p>
            )}
          </form>
          <SecuritySessions />
          <Link className="button secondary" href="/account/settings">
            Return to account settings
          </Link>
        </>
      )}
      <button
        className="button secondary"
        onClick={async () => {
          await request('/auth/logout', {});
          window.location.assign('/login');
        }}
      >
        Sign out
      </button>
      <ErrorNotice error={a.error || localError || error} />
    </section>
  );
}
function SecuritySessions() {
  const { data, error } = useData('/identity/sessions'),
    a = useAction();
  return (
    <div className="spaced">
      <h2>Active sessions</h2>
      {data?.map((s: Row) => (
        <p key={s.id}>
          {s.current ? 'This session' : 'Another session'} · {s.auth_method} · Started{' '}
          {date(s.created_at)} · Expires {date(s.expires_at)}
        </p>
      ))}
      <button
        className="button secondary"
        disabled={a.busy}
        onClick={() => void a.run('/identity/sessions/revoke-others', {}, 'Other sessions ended.')}
      >
        End other sessions
      </button>
      <ErrorNotice error={error || a.error} />
    </div>
  );
}
export function IdentityAction() {
  const captured = useRef(false);
  const { user, loading } = useSession(),
    a = useAction();
  const [token, setToken] = useState(''),
    [reset, setReset] = useState(false),
    [done, setDone] = useState<Row | null>(null);
  useEffect(() => {
    if (loading || captured.current) return;
    captured.current = true;
    setToken(new URLSearchParams(window.location.hash.slice(1)).get('token') || '');
    window.history.replaceState(null, '', window.location.pathname);
  }, [loading]);
  return (
    <section className="panel settings-panel">
      <h1>Verify your email link</h1>
      <p>
        For email verification or an invitation, sign in as the addressed account before opening the
        link. For password recovery, choose the reset option below. Links work once and expire after
        30 minutes.
      </p>
      {!user && <Link href="/login">Sign in, then reopen the original email link</Link>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          const r = await a.run('/identity/consume', {
            token,
            ...(reset ? { password: d.get('password') } : {}),
          });
          if (r?.kind === 'reset') window.location.assign('/login?password_reset=1');
          else if (r) setDone(r);
        }}
      >
        <label className="field">
          <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} />
          This is a password recovery link
        </label>
        {reset && (
          <label className="field">
            New password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
            />
          </label>
        )}
        <button className="button" disabled={!token || a.busy}>
          Use email link
        </button>
      </form>
      {done && (
        <div role="status">
          <p>
            {done.kind === 'reset'
              ? 'Password changed. Sign in again; enrolled MFA remains required.'
              : done.kind === 'invite'
                ? 'Email invitation verified. Accept the invitation in Account settings.'
                : 'Email verified.'}
          </p>
          <Link href={done.kind === 'reset' ? '/login' : '/account/settings'}>Continue</Link>
        </div>
      )}
      <ErrorNotice error={a.error} />
    </section>
  );
}
export function OwnerTransfers() {
  const { data, error } = useData('/identity/owner-transfers'),
    { user, request } = useSession();
  const a = useAction();
  return (
    <section className="spaced">
      <h2>Workspace ownership transfers</h2>
      <p>
        Acceptance makes the recipient the owner and the previous owner a publisher. Both accounts
        must sign in again. Item title and seller payees are preserved.
      </p>
      {!data?.length && <p>No pending ownership transfer.</p>}
      {data?.map((t: Row) => (
        <article className="panel" key={t.id}>
          <strong>{t.organization_name}</strong>
          <p>
            From {t.from_user} to {t.to_user} · Expires {date(t.expires_at)}
          </p>
          {t.to_user === user?.id && (
            <button
              className="button"
              disabled={a.busy}
              onClick={async () => {
                try {
                  await request(`/identity/owner-transfers/${t.id}/decide`, { accept: true });
                  window.location.assign('/login');
                } catch (e) {
                  a.setError(e as Error);
                }
              }}
            >
              Accept workspace ownership
            </button>
          )}
          <button
            className="button secondary"
            disabled={a.busy}
            onClick={() =>
              void a.run(
                `/identity/owner-transfers/${t.id}/decide`,
                { accept: false },
                'Ownership transfer canceled.',
              )
            }
          >
            Cancel ownership transfer
          </button>
        </article>
      ))}
      <ErrorNotice error={error || a.error} />
    </section>
  );
}
export function TransferRequest({ org, members }: { org: string; members: Row[] }) {
  const a = useAction();
  return (
    <details className="spaced">
      <summary>Transfer workspace ownership</summary>
      <p>
        Verify both accounts’ email addresses first. Confirm your password in Account security if
        requested. The nominated member must accept within 24 hours.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          await a.run(
            `/organizations/${org}/owner-transfer`,
            { user_id: d.get('user_id') },
            'Ownership transfer awaiting recipient consent.',
          );
        }}
      >
        <label className="field">
          New workspace owner
          <select name="user_id" required>
            <option value="">Choose an existing member</option>
            {members
              .filter((m) => m.role !== 'owner')
              .map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name} · {m.email}
                </option>
              ))}
          </select>
        </label>
        <button className="button secondary" disabled={a.busy}>
          Request ownership transfer
        </button>
        <ErrorNotice error={a.error} />
      </form>
    </details>
  );
}
export function AccessAdministrationPanel() {
  const { data, error } = useData('/ops/access'),
    a = useAction(),
    { user } = useSession();
  return (
    <section className="panel settings-panel">
      <h2>Staff access administration</h2>
      <p>
        A fresh authenticator verification and independent administrator approval are required.
        Permissions remain local to PixUP; provider claims never grant staff access.
      </p>
      <Link href="/account/security">Confirm authentication</Link>
      <ErrorNotice error={error || a.error} />
      {data && (
        <>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              await a.run(
                '/ops/access',
                {
                  user_id: d.get('user_id'),
                  permissions: d.getAll('permission'),
                  reason: d.get('reason'),
                },
                'Staff access sent for independent review.',
              );
            }}
          >
            <label className="field">
              Staff account
              <select name="user_id" required>
                <option value="">Choose an account</option>
                {data.users
                  .filter((u: Row) => u.id !== user?.id)
                  .map((u: Row) => (
                    <option key={u.id} value={u.id}>
                      {u.email} · Current: {u.permissions.join(', ') || 'none'}
                    </option>
                  ))}
              </select>
            </label>
            <p>
              Select the complete desired permission set. No selected permissions revokes staff
              access.
            </p>
            {data.permissions.map((p: string) => (
              <label className="field" key={p}>
                <input type="checkbox" name="permission" value={p} />
                {p.replaceAll('_', ' ')}
              </label>
            ))}
            <label className="field">
              Access change reason
              <textarea name="reason" minLength={10} maxLength={2000} required />
            </label>
            <button className="button" disabled={a.busy}>
              Request staff access review
            </button>
          </form>
          {data.reviews.map((r: Row) => (
            <article className="panel spaced" key={r.id}>
              <strong>
                {r.user_id} · {r.state}
              </strong>
              <p>
                Previous: {r.previous_permissions.join(', ') || 'none'} → Requested:{' '}
                {r.permissions.join(', ') || 'none'}
              </p>
              <p>{r.reason}</p>
              {r.state === 'pending' && r.requested_by !== user?.id && r.user_id !== user?.id && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const d = new FormData(e.currentTarget),
                      submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement;
                    await a.run(
                      `/ops/access/${r.id}/decide`,
                      { approve: submitter.value === 'approve', note: d.get('note') },
                      'Access review recorded.',
                    );
                  }}
                >
                  <label className="field">
                    Independent decision note
                    <textarea name="note" minLength={10} maxLength={2000} required />
                  </label>
                  <button className="button" value="approve" disabled={a.busy}>
                    Approve access change
                  </button>
                  <button className="button secondary" value="reject" disabled={a.busy}>
                    Reject access change
                  </button>
                </form>
              )}
            </article>
          ))}
        </>
      )}
    </section>
  );
}
