import { supabase } from '@/lib/supabase';

export type WorkspaceRole = 'owner' | 'viewer' | 'editor';

export type WorkspaceAccess = {
  ownerId: string;
  ownerEmail: string;
  role: WorkspaceRole;
  accountCount: number;
};

export type WorkspaceMember = {
  userId: string;
  email: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  accountIds: string[];
  joinedAt: string;
};

export type WorkspaceInvitation = {
  id: string;
  email: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  accountIds: string[];
  expiresAt: string | null;
  createdAt: string;
};

export type WorkspaceNotification = {
  id: string;
  message: string;
  createdAt: string;
  readAt: string | null;
};

export type AdminUser = {
  id: string;
  email: string;
  createdAt: string;
  isSuspended: boolean;
  deletedAt: string | null;
};

export type AdminUserSession = {
  userId: string;
  startedAt: string;
  lastActivityAt: string;
  expiresAt: string;
  isActive: boolean;
  deviceLabel: string | null;
};

export type AdminUserUsage = {
  userId: string;
  transactionCount: number;
  accountCount: number;
  categoryCount: number;
  budgetCount: number;
  recurringEntryCount: number;
  investmentCount: number;
};

export type AdminActivityEvent = {
  id: string;
  actorEmail: string;
  targetEmail: string;
  action: 'account_suspended' | 'account_reactivated' | 'session_terminated' | 'account_deleted';
  details: Record<string, unknown>;
  occurredAt: string;
};

function fail(error: { message: string }): never {
  throw new Error(error.message);
}

function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export async function openFinanceWorkspace(): Promise<void> {
  const { error } = await supabase.rpc('open_finance_workspace');
  if (error) fail(error);
}

export async function loadWorkspaceAccess(): Promise<{ workspaces: WorkspaceAccess[]; isPlatformAdmin: boolean }> {
  const { data, error } = await supabase.rpc('list_accessible_workspaces');
  if (error) fail(error);
  const rows = asRows<{
    owner_id: string;
    owner_email: string;
    role: WorkspaceRole;
    account_count: number | string;
    is_platform_admin: boolean;
  }>(data);
  return {
    workspaces: rows.map((row) => ({
      ownerId: row.owner_id,
      ownerEmail: row.owner_email,
      role: row.role,
      accountCount: Number(row.account_count),
    })),
    isPlatformAdmin: rows.some((row) => row.is_platform_admin),
  };
}

export async function loadWorkspaceSharing(ownerId: string): Promise<{ members: WorkspaceMember[]; invitations: WorkspaceInvitation[]; notifications: WorkspaceNotification[] }> {
  const { data, error } = await supabase.rpc('get_workspace_sharing', { p_owner_id: ownerId });
  if (error) fail(error);
  const value = (data ?? {}) as {
    members?: Array<{ user_id: string; email: string; role: Exclude<WorkspaceRole, 'owner'>; account_ids: string[]; joined_at: string }>;
    invitations?: Array<{ id: string; email: string; role: Exclude<WorkspaceRole, 'owner'>; account_ids: string[]; expires_at: string | null; created_at: string }>;
    notifications?: Array<{ id: string; message: string; created_at: string; read_at: string | null }>;
  };
  return {
    members: (value.members ?? []).map((row) => ({ userId: row.user_id, email: row.email, role: row.role, accountIds: row.account_ids ?? [], joinedAt: row.joined_at })),
    invitations: (value.invitations ?? []).map((row) => ({ id: row.id, email: row.email, role: row.role, accountIds: row.account_ids ?? [], expiresAt: row.expires_at, createdAt: row.created_at })),
    notifications: (value.notifications ?? []).map((row) => ({ id: row.id, message: row.message, createdAt: row.created_at, readAt: row.read_at })),
  };
}

export async function createWorkspaceInvitation(input: {
  ownerId: string;
  email: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  accountIds: string[];
  expiresIn: '24h' | '7d' | '30d' | 'never';
}): Promise<string> {
  const { data, error } = await supabase.rpc('create_workspace_invitation', {
    p_owner_id: input.ownerId,
    p_email: input.email,
    p_role: input.role,
    p_account_ids: input.accountIds,
    p_expires_in: input.expiresIn,
  });
  if (error) fail(error);
  return String(data);
}

export async function cancelWorkspaceInvitation(id: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_workspace_invitation', { p_invitation_id: id });
  if (error) fail(error);
}

export async function updateWorkspaceMember(input: {
  ownerId: string;
  userId: string;
  role: Exclude<WorkspaceRole, 'owner'>;
  accountIds: string[];
}): Promise<void> {
  const { error } = await supabase.rpc('update_workspace_member_access', {
    p_owner_id: input.ownerId,
    p_member_id: input.userId,
    p_role: input.role,
    p_account_ids: input.accountIds,
  });
  if (error) fail(error);
}

export async function revokeWorkspaceMember(ownerId: string, memberId: string): Promise<void> {
  const { error } = await supabase.rpc('revoke_workspace_member', { p_owner_id: ownerId, p_member_id: memberId });
  if (error) fail(error);
}

export async function markWorkspaceNotificationsRead(ownerId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_workspace_notifications_read', { p_owner_id: ownerId });
  if (error) fail(error);
}

export async function loadAdminUsers(): Promise<AdminUser[]> {
  const { data, error } = await supabase.rpc('list_platform_users');
  if (error) fail(error);
  return asRows<{ id: string; email: string; created_at: string; is_suspended: boolean; deleted_at: string | null }>(data).map((row) => ({
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    isSuspended: row.is_suspended,
    deletedAt: row.deleted_at,
  }));
}

export async function setAdminUserSuspended(userId: string, suspended: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_platform_user_suspension', { p_user_id: userId, p_suspended: suspended });
  if (error) fail(error);
}

export async function loadAdminUserSessions(): Promise<AdminUserSession[]> {
  const { data, error } = await supabase.rpc('list_platform_user_sessions');
  if (error) fail(error);
  return asRows<{
    user_id: string;
    session_started_at: string;
    last_activity_at: string;
    expires_at: string;
    is_active: boolean;
    device_label: string | null;
  }>(data).map((row) => ({
    userId: row.user_id,
    startedAt: row.session_started_at,
    lastActivityAt: row.last_activity_at,
    expiresAt: row.expires_at,
    isActive: row.is_active,
    deviceLabel: row.device_label,
  }));
}

export async function loadAdminUserUsage(): Promise<AdminUserUsage[]> {
  const { data, error } = await supabase.rpc('list_platform_user_usage');
  if (error) fail(error);
  return asRows<{
    user_id: string;
    transaction_count: number | string;
    account_count: number | string;
    category_count: number | string;
    budget_count: number | string;
    recurring_entry_count: number | string;
    investment_count: number | string;
  }>(data).map((row) => ({
    userId: row.user_id,
    transactionCount: Number(row.transaction_count),
    accountCount: Number(row.account_count),
    categoryCount: Number(row.category_count),
    budgetCount: Number(row.budget_count),
    recurringEntryCount: Number(row.recurring_entry_count),
    investmentCount: Number(row.investment_count),
  }));
}

export async function terminateAdminUserSession(userId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_terminate_user_session', { p_user_id: userId });
  if (error) fail(error);
}

export async function loadAdminActivity(limit = 30): Promise<AdminActivityEvent[]> {
  const { data, error } = await supabase.rpc('list_platform_admin_activity', {
    p_limit: Math.min(Math.max(Math.trunc(limit), 1), 100),
    p_offset: 0,
  });
  if (error) fail(error);
  return asRows<{
    id: string;
    actor_email: string | null;
    target_email: string;
    action: AdminActivityEvent['action'];
    details: Record<string, unknown> | null;
    occurred_at: string;
  }>(data).map((row) => ({
    id: row.id,
    actorEmail: row.actor_email || 'Administrator',
    targetEmail: row.target_email,
    action: row.action,
    details: row.details ?? {},
    occurredAt: row.occurred_at,
  }));
}

export async function deletePlatformUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_platform_user', { p_user_id: userId });
  if (error) fail(error);
}

export async function deleteCurrentFinanceAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_my_finance_account');
  if (error) fail(error);
}
