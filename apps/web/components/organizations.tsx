'use client';
import type {
  Invitation,
  OrganizationMembers as Members,
} from '../../../packages/domain/contracts';
import { useState } from 'react';
import { useSession, useData, useAction } from './providers';
import { ErrorNotice, Loading, Status, date } from './ui';

export function OrganizationSettings() {
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
      <h2>Workspace invitations</h2>
      <p>
        Invitations appear here for the named account. This pilot does not send email or verify
        email ownership.
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
                {invitation.role} · Expires {date(invitation.expires_at)}
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
              Accept invitation
            </button>
          </div>
        ))
      ) : (
        <p>No pending invitations.</p>
      )}
      {!!org && (
        <>
          <h2>Manage organization</h2>
          <label className="field">
            Organization
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
  const { data, error, isPending } = useData<Members>(`/organizations/${org}/members`);
  const [email, setEmail] = useState(''),
    [role, setRole] = useState('viewer');
  const action = useAction();
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
          Invite account email
          <input
            required
            type="email"
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          Workspace role
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="viewer">Viewer — read collections</option>
            <option value="publisher">Publisher — create and publish</option>
          </select>
        </label>
        <button className="button" disabled={action.busy}>
          Create invitation
        </button>
      </form>
      <ErrorNotice error={action.error} />
      <h3>Members</h3>
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
              Revoke access
            </button>
          )}
        </div>
      ))}
      <h3>Sent invitations</h3>
      {data.invitations.map((invitation) => (
        <div className="workspace-row" key={invitation.id}>
          <div>
            <strong>{invitation.email}</strong>
            <p>
              {invitation.role} · Expires {date(invitation.expires_at)}
            </p>
            <Status status={invitation.status} />
          </div>
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
              Revoke invitation
            </button>
          )}
        </div>
      ))}
    </>
  );
}
