import { Select } from '@/components/select';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LogOut, Search, ShieldCheck, Trash2, X } from 'lucide-react';
import {
  deletePlatformUser,
  loadAdminActivity,
  loadAdminUsers,
  loadAdminUserSessions,
  loadAdminUserUsage,
  setAdminUserSuspended,
  terminateAdminUserSession,
  type AdminActivityEvent,
  type AdminUser,
  type AdminUserSession,
  type AdminUserUsage,
} from '@/lib/workspace-api';

type AccountStatus = 'active' | 'suspended' | 'deleted';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function statusOf(user: AdminUser): AccountStatus {
  return user.deletedAt ? 'deleted' : user.isSuspended ? 'suspended' : 'active';
}

function number(value: number) {
  return new Intl.NumberFormat('en-IN').format(value);
}

function initials(email: string) {
  return email.split('@')[0].split(/[._-]/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'U';
}

function activityLabel(event: AdminActivityEvent) {
  return {
    account_suspended: 'Account suspended',
    account_reactivated: 'Account reactivated',
    session_terminated: 'Active session signed out',
    account_deleted: 'Platform account deleted',
  }[event.action];
}

function activityDetail(event: AdminActivityEvent) {
  return Object.values(event.details)
    .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
    .join(' · ');
}

function UsageSummary({ usage, unavailable = false }: { usage?: AdminUserUsage; unavailable?: boolean }) {
  if (unavailable) return <span className="admin-usage-unavailable">Usage totals unavailable</span>;
  return <div className="admin-usage-summary">
    <b className="admin-count">{number(usage?.transactionCount ?? 0)} transactions</b>
    <small>{number(usage?.accountCount ?? 0)} accounts · {number(usage?.categoryCount ?? 0)} categories</small>
  </div>;
}

function UsageGrid({ usage }: { usage?: AdminUserUsage }) {
  const items = [
    ['Transactions', usage?.transactionCount ?? 0],
    ['Accounts', usage?.accountCount ?? 0],
    ['Categories', usage?.categoryCount ?? 0],
    ['Budgets', usage?.budgetCount ?? 0],
    ['Recurring entries', usage?.recurringEntryCount ?? 0],
    ['Investments', usage?.investmentCount ?? 0],
  ];
  return <div className="admin-usage-grid">{items.map(([label, count]) => <div key={String(label)}><span>{label}</span><b className="admin-count">{number(Number(count))}</b></div>)}</div>;
}

export function AdminUserManagement({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [sessions, setSessions] = useState<AdminUserSession[]>([]);
  const [usage, setUsage] = useState<AdminUserUsage[]>([]);
  const [activity, setActivity] = useState<AdminActivityEvent[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AccountStatus>('all');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [error, setError] = useState('');
  const [usageError, setUsageError] = useState('');
  const [activityError, setActivityError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextUsers, nextSessions] = await Promise.all([loadAdminUsers(), loadAdminUserSessions()]);
      setUsers(nextUsers);
      setSessions(nextSessions);
      setError('');

      try {
        setUsage(await loadAdminUserUsage());
        setUsageError('');
      } catch {
        setUsage([]);
        setUsageError('Apply the private usage-count migration to enable aggregate activity totals.');
      }

      try {
        setActivity(await loadAdminActivity());
        setActivityError('');
      } catch {
        setActivity([]);
        setActivityError('Apply the platform admin activity migration to enable this access-only history.');
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const sessionByUserId = useMemo(() => new Map(sessions.map((session) => [session.userId, session])), [sessions]);
  const usageByUserId = useMemo(() => new Map(usage.map((item) => [item.userId, item])), [usage]);
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const selectedSession = selectedUser ? sessionByUserId.get(selectedUser.id) : undefined;
  const selectedUsage = selectedUser ? usageByUserId.get(selectedUser.id) : undefined;
  const formatter = useMemo(() => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }), []);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }), []);
  const visibleUsers = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return users.filter((user) => (statusFilter === 'all' || statusOf(user) === statusFilter) && (!term || user.email.toLocaleLowerCase().includes(term)));
  }, [query, statusFilter, users]);
  const liveUsers = users.filter((user) => !user.deletedAt);
  const activeCount = liveUsers.filter((user) => !user.isSuspended).length;
  const suspendedCount = liveUsers.filter((user) => user.isSuspended).length;
  const now = new Date();
  const joinedThisMonth = liveUsers.filter((user) => {
    const created = new Date(user.createdAt);
    return created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth();
  }).length;

  const toggle = async (user: AdminUser) => {
    try {
      await setAdminUserSuspended(user.id, !user.isSuspended);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const remove = async (user: AdminUser) => {
    if (!window.confirm(`Permanently delete ${user.email} and their finance workspace?`)) return;
    try {
      await deletePlatformUser(user.id);
      setSelectedUserId('');
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const terminate = async (user: AdminUser) => {
    if (!window.confirm(`Sign ${user.email} out from their active device?`)) return;
    try {
      await terminateAdminUserSession(user.id);
      await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return <section className="admin-workspace" aria-label="Platform administration">
    <div className="admin-workspace-topline"><span>Workspace / <b>Administration</b></span><span className="admin-secure-chip"><i /> Admin session secured</span></div>
    <div className="admin-workspace-heading">
      <div><div className="eyebrow">Workspace administration</div><h2>User management</h2><p>Manage account access and view privacy-safe activity totals without opening anyone’s financial records.</p></div>
      <button className="secondary-button admin-refresh" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh users'}</button>
    </div>

    <div className="admin-stat-grid">
      <article><span>Total accounts</span><strong className="admin-count">{number(liveUsers.length)}</strong><small>Registered platform users</small></article>
      <article><span>Active accounts</span><strong className="admin-count">{number(activeCount)}</strong><small>Currently permitted access</small></article>
      <article><span>Suspended accounts</span><strong className="admin-count">{number(suspendedCount)}</strong><small>Access temporarily blocked</small></article>
      <article><span>Joined this month</span><strong className="admin-count">{number(joinedThisMonth)}</strong><small>New platform accounts</small></article>
    </div>

    <section className="surface-card admin-users-panel">
      <div className="admin-users-panel-heading">
        <div><h3>Platform users</h3><p>Account identity, sign-in status, and aggregate usage totals only.</p></div>
        <div className="admin-user-tools">
          <label className="admin-user-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search email address" aria-label="Search users" /></label>
          <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} aria-label="Filter users by account status"><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="deleted">Deleted</option></Select>
        </div>
      </div>
      {error ? <p className="form-error admin-panel-error">{error}</p> : null}
      {usageError ? <p className="admin-usage-message">{usageError}</p> : null}
      {loading ? <p className="card-note admin-panel-loading">Loading users…</p> : <div className="admin-users-table-scroll"><table>
        <thead><tr><th>User</th><th>Account status</th><th>Joined</th><th>Last sign-in</th><th>Usage totals</th><th>Active session</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{visibleUsers.length ? visibleUsers.map((user) => {
          const session = sessionByUserId.get(user.id);
          const userUsage = usageByUserId.get(user.id);
          const status = statusOf(user);
          return <tr key={user.id}>
            <td><div className="admin-user-identity"><span>{initials(user.email)}</span><div><b>{user.email}</b><small>{user.id === currentUserId ? 'Platform administrator' : 'Platform user'}</small></div></div></td>
            <td><span className={`admin-status ${status}`}>{status === 'active' ? 'Active' : status === 'suspended' ? 'Suspended' : 'Deleted'}</span></td>
            <td>{dateFormatter.format(new Date(user.createdAt))}</td>
            <td>{session ? formatter.format(new Date(session.startedAt)) : '—'}</td>
            <td><UsageSummary usage={userUsage} unavailable={Boolean(usageError)} /></td>
            <td><span className={session?.isActive ? 'admin-session active' : 'admin-session'}>{session?.isActive ? 'Signed in' : 'No active session'}</span></td>
            <td className="admin-manage-cell"><button className="text-button" type="button" onClick={() => setSelectedUserId(user.id)}>Manage →</button></td>
          </tr>;
        }) : <tr><td className="admin-table-empty" colSpan={7}>No users match this search.</td></tr>}</tbody>
      </table></div>}
    </section>

    <section className="surface-card admin-activity-panel" aria-label="Administrator activity">
      <div className="admin-activity-heading"><div><h3>Admin activity</h3><p>Recent account-access actions. Financial records are never included.</p></div><span className="admin-count">{number(activity.length)} recent</span></div>
      {loading ? <p className="card-note admin-panel-loading">Loading activity…</p> : activityError ? <p className="card-note admin-activity-empty">{activityError}</p> : activity.length ? <ol className="admin-activity-list">{activity.map((event) => <li key={event.id}><span className={`admin-activity-icon ${event.action}`}><ShieldCheck size={14} /></span><div><b>{activityLabel(event)}</b><p>{event.targetEmail} · by {event.actorEmail}{activityDetail(event) ? ` · ${activityDetail(event)}` : ''}</p></div><time dateTime={event.occurredAt}>{formatter.format(new Date(event.occurredAt))}</time></li>)}</ol> : <p className="card-note admin-activity-empty">No administrator actions have been recorded yet.</p>}
    </section>

    <aside className={`admin-user-drawer ${selectedUser ? 'open' : ''}`} role="dialog" aria-modal="true" aria-label="User account controls" aria-hidden={!selectedUser}>
      {selectedUser ? <>
        <div className="admin-drawer-heading"><span className="eyebrow">Account overview</span><button className="icon-button" type="button" aria-label="Close user management" onClick={() => setSelectedUserId('')}><X size={18} /></button></div>
        <div className="admin-drawer-profile"><span>{initials(selectedUser.email)}</span><div><h3>{selectedUser.email}</h3><p>{selectedUser.id === currentUserId ? 'Platform administrator' : 'Platform user'}</p></div></div>
        <p className="admin-drawer-label">Account information</p>
        <div className="admin-drawer-details">
          <div><span>Account status</span><b>{statusOf(selectedUser) === 'active' ? 'Active' : statusOf(selectedUser) === 'suspended' ? 'Suspended' : 'Deleted'}</b></div>
          <div><span>Joined on</span><b>{dateFormatter.format(new Date(selectedUser.createdAt))}</b></div>
          <div><span>Last sign-in</span><b>{selectedSession ? formatter.format(new Date(selectedSession.startedAt)) : 'No sign-in recorded'}</b></div>
          <div><span>Session activity</span><b>{selectedSession?.isActive ? `Active · ${selectedSession.deviceLabel ?? 'Device not recorded'}` : 'No active session'}</b></div>
        </div>
        <p className="admin-drawer-label">Private usage totals</p>
        {usageError ? <p className="admin-usage-drawer-message">Usage totals are unavailable until the private usage-count migration is applied.</p> : <UsageGrid usage={selectedUsage} />}
        <p className="admin-drawer-label">Administrator controls</p>
        <div className="admin-access-note"><ShieldCheck size={16} /><div><b>Platform access only</b><p>These controls affect sign-in access only. They never reveal or change the user’s transactions, balances, investments, or other finance records.</p></div></div>
        {selectedUser.id === currentUserId ? <p className="admin-self-note">You cannot change your own administrator access from this screen.</p> : <div className="admin-drawer-actions">{selectedSession?.isActive ? <button className="secondary-button" type="button" onClick={() => void terminate(selectedUser)}><LogOut size={14} /> Sign out active device</button> : null}<button className="secondary-button" type="button" onClick={() => void toggle(selectedUser)}>{selectedUser.isSuspended ? 'Reactivate account' : 'Suspend account'}</button><button className="ghost-button danger" type="button" disabled={Boolean(selectedUser.deletedAt)} onClick={() => void remove(selectedUser)}><Trash2 size={14} /> Delete platform account</button></div>}
      </> : null}
    </aside>
    {selectedUser ? <button className="admin-user-overlay" type="button" aria-label="Close user management" onClick={() => setSelectedUserId('')} /> : null}
    <div className="admin-privacy-note"><ShieldCheck size={18} /><div><b>Financial details remain private</b><p>Usage totals help identify inactive accounts. They show only counts of transactions, accounts, categories, budgets, recurring entries, and investments—not balances, amounts, names, descriptions, dates, or individual finance records.</p></div></div>
  </section>;
}
