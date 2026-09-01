import { useCallback, useEffect, useState } from 'react';
import { api, type TeamResponse } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { Badge, Card, ErrorBlock, Spinner } from '../components/ui.tsx';
import { formatRelative, titleCase } from '../lib/format.tsx';

export function SettingsPage() {
  const { session, refresh } = useAuth();
  const [team, setTeam] = useState<TeamResponse | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState({ email: '', name: '', password: '', role: 'member' });

  const isAdmin = session?.user.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.team();
      setTeam(data);
      setWorkspaceName(data.workspace.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load team settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    document.title = 'Team settings · SaaS Demand Radar';
    void load();
  }, [load]);

  async function saveName() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api.renameWorkspace(workspaceName.trim());
      setMessage('Workspace renamed.');
      await load();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to rename the workspace.');
    } finally {
      setBusy(false);
    }
  }

  async function createMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.createMember(invite);
      setTeam({ ...(team as TeamResponse), members: result.members });
      setInvite({ email: '', name: '', password: '', role: 'member' });
      setMessage(`${invite.email} was added to the workspace.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to add the member.');
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(id: string, role: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.updateMemberRole(id, role);
      setTeam({ ...(team as TeamResponse), members: result.members });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to change the role.');
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(id: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.deleteMember(id);
      setTeam({ ...(team as TeamResponse), members: result.members });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to remove the member.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page" data-testid="team-settings">
      <header className="page__header">
        <div>
          <h1>Team settings</h1>
          <p className="page__subtitle">
            Workspace, roles and access. Every member shares the same workspace data; other
            workspaces are isolated.
          </p>
        </div>
        <div className="page__actions">
          <Badge tone={isAdmin ? 'positive' : 'neutral'}>
            {isAdmin ? 'Admin' : 'Member'}
          </Badge>
        </div>
      </header>

      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      {error ? <ErrorBlock error={error} onRetry={() => void load()} /> : null}

      {loading && !team ? <Spinner label="Loading team…" /> : null}
      {loading && team ? (
        <p className="muted" role="status">
          Updating…
        </p>
      ) : null}

      {team ? (
        <>
          <Card
            title="Workspace"
            description="Only an admin can rename the workspace."
            testId="workspace-settings"
          >
            <div className="input-row">
              <div className="field field--grow">
                <label htmlFor="workspace-name">Workspace name</label>
                <input
                  id="workspace-name"
                  type="text"
                  value={workspaceName}
                  maxLength={80}
                  disabled={!isAdmin}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn btn--primary"
                disabled={!isAdmin || busy || workspaceName.trim() === team.workspace.name}
                onClick={() => void saveName()}
              >
                Save
              </button>
            </div>
            <p className="muted">
              {team.stats.total} member{team.stats.total === 1 ? '' : 's'} ·{' '}
              {team.stats.admins} admin{team.stats.admins === 1 ? '' : 's'}
            </p>
          </Card>

          <Card title="Members" description="Admins manage roles; members get read and review access.">
            <table className="table" data-testid="member-table">
              <caption className="sr-only">Workspace members</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Last seen</th>
                  {isAdmin ? <th scope="col">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {team.members.map((member) => (
                  <tr key={member.id}>
                    <th scope="row">{member.name}</th>
                    <td>{member.email}</td>
                    <td>
                      {isAdmin ? (
                        <select
                          value={member.role}
                          disabled={busy}
                          aria-label={`Role for ${member.email}`}
                          onChange={(event) => void changeRole(member.id, event.target.value)}
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                        </select>
                      ) : (
                        <Badge tone={member.role === 'admin' ? 'positive' : 'neutral'}>
                          {titleCase(member.role)}
                        </Badge>
                      )}
                    </td>
                    <td>{formatRelative(member.lastSeenAt)}</td>
                    {isAdmin ? (
                      <td>
                        <button
                          type="button"
                          className="btn btn--small btn--negative"
                          disabled={busy || member.id === session?.user.id}
                          onClick={() => void removeMember(member.id)}
                        >
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {isAdmin ? (
            <Card title="Invite a member" description="The new account joins this workspace only.">
              <form className="invite-form" onSubmit={createMember}>
                <div className="field">
                  <label htmlFor="invite-email">Email</label>
                  <input
                    id="invite-email"
                    type="email"
                    required
                    value={invite.email}
                    onChange={(event) => setInvite({ ...invite, email: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="invite-name">Name</label>
                  <input
                    id="invite-name"
                    type="text"
                    required
                    value={invite.name}
                    onChange={(event) => setInvite({ ...invite, name: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="invite-password">Temporary password</label>
                  <input
                    id="invite-password"
                    type="text"
                    required
                    minLength={10}
                    value={invite.password}
                    onChange={(event) => setInvite({ ...invite, password: event.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="invite-role">Role</label>
                  <select
                    id="invite-role"
                    value={invite.role}
                    onChange={(event) => setInvite({ ...invite, role: event.target.value })}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <button type="submit" className="btn btn--primary" disabled={busy}>
                  Add member
                </button>
              </form>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
