'use client';
import { useI18n } from './i18n';
import { OwnerTransfers, TransferRequest } from './identity-access';
import type {
  Invitation,
  OrganizationMembers as Members,
} from '../../../packages/domain/contracts';
import { useState } from 'react';
import { useSession, useData, useAction } from './providers';
import { ErrorNotice, Loading, Status } from './ui';

export function OrganizationSettings() {
  const { t: tr, date } = useI18n();

  const { user, clearPrivateData } = useSession();
  const { data: invitations, error } = useData<Invitation[]>('/me/invitations');
  const action = useAction();
  const organizations = user!.organizations.filter(
    (o) => o.role === 'owner' && o.kind !== 'personal',
  );
  const [chosen, setChosen] = useState('');
  const org = organizations.find((o) => o.id === chosen) || organizations[0];
  return (
    <section className="panel settings-panel">
      <h2>{tr('Workspace invitations')}</h2>
      <p>
        {tr(
          'Invitations appear for the addressed account. When verified invitation delivery is enabled, open the email link before accepting.',
        )}
      </p>
      <ErrorNotice error={error || action.error} />
      {!invitations ? (
        <Loading />
      ) : invitations.length ? (
        invitations.map((invitation) => (
          <div className="workspace-row" key={invitation.id}>
            <div>
              <strong>{invitation.organization_name}</strong>
              <p>
                {invitation.role}
                {tr(' · Expires ')}
                {date(invitation.expires_at)}
              </p>
            </div>
            <button
              className="button small"
              disabled={action.busy}
              onClick={() =>
                void action.run(
                  `/invitations/${invitation.id}/accept`,
                  {},
                  'Workspace invitation accepted.',
                )
              }
            >
              {tr('Accept invitation')}
            </button>
          </div>
        ))
      ) : (
        <p>{tr('No pending invitations.')}</p>
      )}
      <OwnerTransfers />
      {!!org && (
        <>
          <h2>{tr('Manage organization')}</h2>
          <label className="field">
            {tr('Organization')}
            <select
              value={org.id}
              onChange={async (e) => {
                const value = e.target.value;
                await clearPrivateData();
                setChosen(value);
              }}
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <OrganizationMembers key={org.id} org={org.id} />
        </>
      )}
    </section>
  );
}
function OrganizationMembers({ org }: { org: string }) {
  const { t: tr, date } = useI18n();

  const { data, error, isPending } = useData<Members>(`/organizations/${org}/members`);
  const [email, setEmail] = useState(''),
    [role, setRole] = useState('viewer');
  const action = useAction();
  const { data: identityConfig } = useData('/identity/config');
  if (error) return <ErrorNotice error={error} />;
  if (isPending || !data) return <Loading />;
  return (
    <>
      <form
        className="form-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await action.run(
              `/organizations/${org}/invitations`,
              { email, role },
              'Invitation created.',
            )
          )
            setEmail('');
        }}
      >
        <label className="field">
          {tr('Invite account email')}
          <input
            required
            type="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          {tr('Workspace role')}
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="viewer">{tr('Viewer — read collections')}</option>
            <option value="publisher">{tr('Publisher — create and publish')}</option>
          </select>
        </label>
        <button className="button" disabled={action.busy}>
          {tr('Create invitation')}
        </button>
      </form>
      <ErrorNotice error={action.error} />
      <h3>{tr('Members')}</h3>
      {data.members.map((member) => (
        <div className="workspace-row" key={member.user_id}>
          <div>
            <strong>{member.name}</strong>
            <p>
              {member.email} · {member.role}
            </p>
          </div>
          {member.role !== 'owner' && (
            <button
              className="button small secondary"
              disabled={action.busy}
              onClick={() =>
                void action.run(
                  `/organizations/${org}/members/${member.user_id}/revoke`,
                  {},
                  'Access revoked and existing sessions ended.',
                )
              }
            >
              {tr('Revoke access')}
            </button>
          )}
        </div>
      ))}
      <TransferRequest org={org} members={data.members} />
      <h3>{tr('Sent invitations')}</h3>
      {data.invitations.map((invitation) => (
        <div className="workspace-row" key={invitation.id}>
          <div>
            <strong>{invitation.email}</strong>
            <p>
              {invitation.role}
              {tr(' · Expires ')}
              {date(invitation.expires_at)}
            </p>
            <Status status={invitation.status} />
          </div>
          {invitation.status === 'pending' && identityConfig?.mail_enabled && (
            <button
              className="button small secondary"
              disabled={action.busy}
              onClick={() =>
                void action.run(
                  `/organizations/${org}/invitations/${invitation.id}/resend`,
                  {},
                  'Invitation email queued.',
                )
              }
            >
              {tr('Resend invitation email')}
            </button>
          )}
          {invitation.status === 'pending' && (
            <button
              className="button small secondary"
              disabled={action.busy}
              onClick={() =>
                void action.run(
                  `/organizations/${org}/invitations/${invitation.id}/revoke`,
                  {},
                  'Invitation revoked.',
                )
              }
            >
              {tr('Revoke invitation')}
            </button>
          )}
        </div>
      ))}
    </>
  );
}
