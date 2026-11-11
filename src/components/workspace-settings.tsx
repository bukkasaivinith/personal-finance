import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Bell, LogOut, Search, ShieldCheck, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react';
import type { Account } from '@/lib/finance';
import {
  cancelWorkspaceInvitation,
  createWorkspaceInvitation,
  deleteCurrentFinanceAccount,
  deletePlatformUser,
  loadAdminUsers,
  loadAdminUserSessions,
  loadWorkspaceSharing,
  markWorkspaceNotificationsRead,
  revokeWorkspaceMember,
  setAdminUserSuspended,
  terminateAdminUserSession,
  updateWorkspaceMember,
  type AdminUser,
  type AdminUserSession,
  type WorkspaceInvitation,
  type WorkspaceMember,
  type WorkspaceNotification,
  type WorkspaceRole,
} from '@/lib/workspace-api';

type ShareRole = Exclude<WorkspaceRole, 'owner'>;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function accountLabel(account: Account) {
  return account.description ? `${account.name} · ${account.description}` : account.name;
}

function ShareAccountPicker({ accounts, selectedIds, onChange, disabled = false }: { accounts: Account[]; selectedIds: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const toggle = (id: string) => onChange(selectedIds.includes(id) ? selectedIds.filter((current) => current !== id) : [...selectedIds, id]);
  return <div className="workspace-account-picker" aria-label="Accounts to share">
    {accounts.map((account) => <label key={account.id} className="workspace-account-option"><input type="checkbox" checked={selectedIds.includes(account.id)} onChange={() => toggle(account.id)} disabled={disabled} /><span>{accountLabel(account)}</span></label>)}
  </div>;
}

function WorkspaceMemberRow({ member, accounts, onSave, onRemove }: { member: WorkspaceMember; accounts: Account[]; onSave: (role: ShareRole, accountIds: string[]) => Promise<void>; onRemove: () => Promise<void> }) {
  const [role, setRole] = useState<ShareRole>(member.role);
  const [accountIds, setAccountIds] = useState(member.accountIds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => { setBusy(true); setError(''); try { await onSave(role, accountIds); } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); } };
  const remove = async () => { if (!window.confirm(`Remove ${member.email} from this workspace?`)) return; setBusy(true); setError(''); try { await onRemove(); } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); } };
  return <article className="workspace-member-row"><div className="workspace-member-heading"><div><b>{member.email}</b><small>Joined {new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(member.joinedAt))}</small></div><button className="ghost-button danger" type="button" disabled={busy} onClick={() => void remove()}><UserMinus size={14} /> Remove</button></div><div className="workspace-member-controls"><label>Permission<select value={role} onChange={(event) => setRole(event.target.value as ShareRole)} disabled={busy}><option value="viewer">Viewer — view only</option><option value="editor">Editor — add, edit and delete</option></select></label><div><span>Selected accounts</span><ShareAccountPicker accounts={accounts} selectedIds={accountIds} onChange={setAccountIds} disabled={busy} /></div></div>{error ? <p className="form-error">{error}</p> : null}<button className="secondary-button" type="button" disabled={busy || accountIds.length === 0} onClick={() => void save()}>{busy ? 'Saving…' : 'Save access'}</button></article>;
}

function InvitationRow({ invite, accounts, onCancel }: { invite: WorkspaceInvitation; accounts: Account[]; onCancel: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const visibleAccounts = accounts.filter((account) => invite.accountIds.includes(account.id)).map((account) => account.name).join(', ');
  const cancel = async () => { setBusy(true); try { await onCancel(); } finally { setBusy(false); } };
  return <article className="workspace-invite-row"><div><b>{invite.email}</b><small>{invite.role === 'editor' ? 'Editor' : 'Viewer'} · {visibleAccounts || 'No active accounts'} · {invite.expiresAt ? `Expires ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(new Date(invite.expiresAt))}` : 'Until cancelled'}</small></div><button className="ghost-button danger" type="button" disabled={busy} onClick={() => void cancel()}>Cancel invite</button></article>;
}

function WorkspaceSharing({ ownerId, accounts, onChange }: { ownerId: string; accounts: Account[]; onChange: () => Promise<void> }) {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitation[]>([]);
  const [notifications, setNotifications] = useState<WorkspaceNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ShareRole>('viewer');
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [expiry, setExpiry] = useState<'24h' | '7d' | '30d' | 'never'>('7d');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const activeAccounts = useMemo(() => accounts.filter((account) => account.isActive && account.deletedAt === null), [accounts]);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadWorkspaceSharing(ownerId);
      setMembers(data.members); setInvitations(data.invitations); setNotifications(data.notifications); setError('');
    } catch (caught) { setError(errorMessage(caught)); } finally { setLoading(false); }
  }, [ownerId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const invite = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const id = await createWorkspaceInvitation({ ownerId, email: email.trim(), role, accountIds, expiresIn: expiry });
      const link = `${window.location.origin}/?workspace-invite=${encodeURIComponent(id)}`;
      try { await navigator.clipboard.writeText(link); setNotice('Invitation created. Its secure link has been copied; send it only to that email address.'); } catch { setNotice(`Invitation created. Send this link only to that email address: ${link}`); }
      setEmail(''); setAccountIds([]); await refresh(); await onChange();
    } catch (caught) { setError(errorMessage(caught)); } finally { setBusy(false); }
  };
  const changeMember = async (member: WorkspaceMember, nextRole: ShareRole, nextAccountIds: string[]) => { await updateWorkspaceMember({ ownerId, userId: member.userId, role: nextRole, accountIds: nextAccountIds }); await refresh(); await onChange(); };
  const removeMember = async (member: WorkspaceMember) => { await revokeWorkspaceMember(ownerId, member.userId); await refresh(); await onChange(); };
  const cancelInvite = async (invite: WorkspaceInvitation) => { await cancelWorkspaceInvitation(invite.id); await refresh(); };
  const readNotifications = async () => { await markWorkspaceNotificationsRead(ownerId); await refresh(); };

  return <section className="surface-card workspace-settings-card"><div className="card-title-row"><div><h3><Users size={16} /> Share selected accounts</h3><p>Only you, the workspace owner, can invite people. They see only the accounts you select.</p></div></div>{notifications.length ? <div className="workspace-notifications"><div><Bell size={15} /><b>Recent shared-workspace activity</b></div>{notifications.map((notification) => <p key={notification.id}>{notification.message}<small>{new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(notification.createdAt))}</small></p>)}<button className="text-button" type="button" onClick={() => void readNotifications()}>Mark all read</button></div> : null}<form className="workspace-invite-form" onSubmit={invite}><label>Email address<input type="email" value={email} maxLength={254} onChange={(event) => setEmail(event.target.value)} placeholder="person@example.com" required disabled={busy} /></label><label>Permission<select value={role} onChange={(event) => setRole(event.target.value as ShareRole)} disabled={busy}><option value="viewer">Viewer — view only</option><option value="editor">Editor — add, edit and delete</option></select></label><label>Invitation expires<select value={expiry} onChange={(event) => setExpiry(event.target.value as typeof expiry)} disabled={busy}><option value="24h">24 hours</option><option value="7d">7 days</option><option value="30d">30 days</option><option value="never">Until cancelled</option></select></label><div className="workspace-invite-accounts"><span>Accounts to share</span>{activeAccounts.length ? <ShareAccountPicker accounts={activeAccounts} selectedIds={accountIds} onChange={setAccountIds} disabled={busy} /> : <small>Add an active account before inviting anyone.</small>}</div>{error ? <p className="form-error full-field">{error}</p> : null}{notice ? <p className="auth-notice full-field">{notice}</p> : null}<button className="primary-button full-field" type="submit" disabled={busy || !accountIds.length}>{busy ? 'Creating invitation…' : <><UserPlus size={15} /> Create invitation</>}</button></form>{loading ? <p className="card-note">Loading people with access…</p> : <><div className="workspace-list-heading"><h4>People with access</h4><span>{members.length}</span></div>{members.length ? <div className="workspace-member-list">{members.map((member) => <WorkspaceMemberRow key={member.userId} member={member} accounts={activeAccounts} onSave={(nextRole, nextAccounts) => changeMember(member, nextRole, nextAccounts)} onRemove={() => removeMember(member)} />)}</div> : <p className="card-note">No one else can access this workspace yet.</p>}<div className="workspace-list-heading"><h4>Pending invitations</h4><span>{invitations.length}</span></div>{invitations.length ? <div className="workspace-invite-list">{invitations.map((invite) => <InvitationRow key={invite.id} invite={invite} accounts={activeAccounts} onCancel={() => cancelInvite(invite)} />)}</div> : <p className="card-note">No invitations are waiting.</p>}</>}</section>;
}

function AdminUsers({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [sessions, setSessions] = useState<AdminUserSession[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended' | 'deleted'>('all');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextUsers, nextSessions] = await Promise.all([loadAdminUsers(), loadAdminUserSessions()]);
      setUsers(nextUsers); setSessions(nextSessions); setError('');
    } catch (caught) { setError(errorMessage(caught)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const sessionByUserId = useMemo(() => new Map(sessions.map((session) => [session.userId, session])), [sessions]);
  const selectedUser = users.find((user) => user.id === selectedUserId) ?? null;
  const selectedSession = selectedUser ? sessionByUserId.get(selectedUser.id) : undefined;
  const formatter = useMemo(() => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }), []);
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }), []);
  const statusOf = (user: AdminUser) => user.deletedAt ? 'deleted' : user.isSuspended ? 'suspended' : 'active';
  const visibleUsers = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return users.filter((user) => (statusFilter === 'all' || statusOf(user) === statusFilter) && (!term || user.email.toLocaleLowerCase().includes(term)));
  }, [query, statusFilter, users]);
  const liveUsers = users.filter((user) => !user.deletedAt);
  const activeCount = liveUsers.filter((user) => !user.isSuspended).length;
  const suspendedCount = liveUsers.filter((user) => user.isSuspended).length;
  const now = new Date();
  const joinedThisMonth = liveUsers.filter((user) => { const created = new Date(user.createdAt); return created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth(); }).length;

  const toggle = async (user: AdminUser) => {
    try { await setAdminUserSuspended(user.id, !user.isSuspended); await refresh(); } catch (caught) { setError(errorMessage(caught)); }
  };
  const remove = async (user: AdminUser) => {
    if (!window.confirm(`Permanently delete ${user.email} and their finance workspace?`)) return;
    try { await deletePlatformUser(user.id); setSelectedUserId(''); await refresh(); } catch (caught) { setError(errorMessage(caught)); }
  };
  const terminate = async (user: AdminUser) => {
    if (!window.confirm(`Sign ${user.email} out from their active device?`)) return;
    try { await terminateAdminUserSession(user.id); await refresh(); } catch (caught) { setError(errorMessage(caught)); }
  };

  return <section className="admin-workspace" aria-label="Platform administration">
    <div className="admin-workspace-topline"><span>Workspace / <b>Administration</b></span><span className="admin-secure-chip"><i /> Admin session secured</span></div>
    <div className="admin-workspace-heading">
      <div><div className="eyebrow">Workspace administration</div><h2>User management</h2><p>Manage account access and sessions without accessing anyone’s private financial data.</p></div>
      <button className="secondary-button admin-refresh" type="button" onClick={() => void refresh()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh users'}</button>
    </div>
    <div className="admin-stat-grid">
      <article><span>Total accounts</span><strong>{String(liveUsers.length).padStart(2, '0')}</strong><small>Registered platform users</small></article>
      <article><span>Active accounts</span><strong>{String(activeCount).padStart(2, '0')}</strong><small>Currently permitted access</small></article>
      <article><span>Suspended accounts</span><strong>{String(suspendedCount).padStart(2, '0')}</strong><small>Access temporarily blocked</small></article>
      <article><span>Joined this month</span><strong>{String(joinedThisMonth).padStart(2, '0')}</strong><small>New platform accounts</small></article>
    </div>
    <section className="surface-card admin-users-panel">
      <div className="admin-users-panel-heading"><div><h3>Platform users</h3><p>Account identity, account access and active-session status only.</p></div><div className="admin-user-tools"><label className="admin-user-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search email address" aria-label="Search users" /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} aria-label="Filter users by account status"><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="deleted">Deleted</option></select></div></div>
      {error ? <p className="form-error admin-panel-error">{error}</p> : null}
      {loading ? <p className="card-note admin-panel-loading">Loading users…</p> : <div className="admin-users-table-scroll"><table><thead><tr><th>User</th><th>Account status</th><th>Joined</th><th>Last sign-in</th><th>Active session</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{visibleUsers.length ? visibleUsers.map((user) => { const session = sessionByUserId.get(user.id); const status = statusOf(user); const initials = user.email.split('@')[0].split(/[._-]/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'U'; return <tr key={user.id}><td><div className="admin-user-identity"><span>{initials}</span><div><b>{user.email}</b><small>{user.id === currentUserId ? 'Platform administrator' : 'Platform user'}</small></div></div></td><td><span className={`admin-status ${status}`}>{status === 'active' ? 'Active' : status === 'suspended' ? 'Suspended' : 'Deleted'}</span></td><td>{dateFormatter.format(new Date(user.createdAt))}</td><td>{session ? formatter.format(new Date(session.startedAt)) : '—'}</td><td><span className={session?.isActive ? 'admin-session active' : 'admin-session'}>{session?.isActive ? 'Signed in' : 'No active session'}</span></td><td className="admin-manage-cell"><button className="text-button" type="button" onClick={() => setSelectedUserId(user.id)}>Manage →</button></td></tr>; }) : <tr><td className="admin-table-empty" colSpan={6}>No users match this search.</td></tr>}</tbody></table></div>}
    </section>
    <aside className={`admin-user-drawer ${selectedUser ? 'open' : ''}`} role="dialog" aria-modal="true" aria-label="User account controls" aria-hidden={!selectedUser}>
      {selectedUser ? <><div className="admin-drawer-heading"><span className="eyebrow">Account overview</span><button className="icon-button" type="button" aria-label="Close user management" onClick={() => setSelectedUserId('')}><X size={18} /></button></div><div className="admin-drawer-profile"><span>{selectedUser.email.slice(0, 2).toUpperCase()}</span><div><h3>{selectedUser.email}</h3><p>{selectedUser.id === currentUserId ? 'Platform administrator' : 'Platform user'}</p></div></div><p className="admin-drawer-label">Account information</p><div className="admin-drawer-details"><div><span>Account status</span><b>{statusOf(selectedUser) === 'active' ? 'Active' : statusOf(selectedUser) === 'suspended' ? 'Suspended' : 'Deleted'}</b></div><div><span>Joined on</span><b>{dateFormatter.format(new Date(selectedUser.createdAt))}</b></div><div><span>Last sign-in</span><b>{selectedSession ? formatter.format(new Date(selectedSession.startedAt)) : 'No sign-in recorded'}</b></div><div><span>Session activity</span><b>{selectedSession?.isActive ? `Active · ${selectedSession.deviceLabel ?? 'Device not recorded'}` : 'No active session'}</b></div></div><p className="admin-drawer-label">Administrator controls</p><div className="admin-access-note"><ShieldCheck size={16} /><div><b>Platform access only</b><p>These controls affect sign-in access only. They never reveal or change the user’s transactions, balances, investments, or other finance records.</p></div></div>{selectedUser.id === currentUserId ? <p className="admin-self-note">You cannot change your own administrator access from this screen.</p> : <div className="admin-drawer-actions">{selectedSession?.isActive ? <button className="secondary-button" type="button" onClick={() => void terminate(selectedUser)}><LogOut size={14} /> Sign out active device</button> : null}<button className="secondary-button" type="button" onClick={() => void toggle(selectedUser)}>{selectedUser.isSuspended ? 'Reactivate account' : 'Suspend account'}</button><button className="ghost-button danger" type="button" disabled={Boolean(selectedUser.deletedAt)} onClick={() => void remove(selectedUser)}><Trash2 size={14} /> Delete platform account</button></div>}</> : null}
    </aside>
    {selectedUser ? <button className="admin-user-overlay" type="button" aria-label="Close user management" onClick={() => setSelectedUserId('')} /> : null}
    <div className="admin-privacy-note"><ShieldCheck size={18} /><div><b>Financial data is private — including from administrators</b><p>This area is limited to platform account administration. It does not show balances, transactions, budgets, categories, reports, investments, or other personal finance records. Admin actions affect sign-in access only.</p></div></div>
  </section>;
}

export function WorkspaceSettings({ ownerId, isOwner, isPlatformAdmin, currentUserId, accounts, onWorkspaceChanged, onDeleteOwnAccount }: { ownerId: string; isOwner: boolean; isPlatformAdmin: boolean; currentUserId: string; accounts: Account[]; onWorkspaceChanged: () => Promise<void>; onDeleteOwnAccount: () => Promise<void> }) {
  const [deleting, setDeleting] = useState(false);
  const deleteAccount = async () => { if (!window.confirm('Permanently delete your account? If you own this workspace, every workspace record and all shared access will be deleted. This cannot be undone.')) return; setDeleting(true); try { await deleteCurrentFinanceAccount(); await onDeleteOwnAccount(); } finally { setDeleting(false); } };
  return <>{isOwner ? <WorkspaceSharing ownerId={ownerId} accounts={accounts} onChange={onWorkspaceChanged} /> : <section className="surface-card settings-card"><div className="card-title-row"><div><h3><Users size={16} /> Shared workspace</h3><p>You can access only the selected accounts that this workspace owner has shared with you.</p></div></div></section>}{isPlatformAdmin ? <AdminUsers currentUserId={currentUserId} /> : null}<section className="surface-card workspace-danger-card"><div><h3>Delete my account</h3><p>{isOwner ? 'This permanently deletes your workspace, all financial data, invitations and shared access.' : 'This permanently deletes your private data and removes your shared-workspace access.'}</p></div><button className="primary-button danger" type="button" disabled={deleting} onClick={() => void deleteAccount()}>{deleting ? 'Deleting…' : <><Trash2 size={15} /> Delete account</>}</button></section></>;
}
